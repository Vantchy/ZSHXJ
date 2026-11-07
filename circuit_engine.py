"""单比特电路图校验与离散逻辑模拟。

模拟器包括理想CMOS导通、组合门、反馈稳定性判断及时序状态推进，
不计算模拟电压和晶体管传播延迟。
"""
from __future__ import annotations

import copy
import json
import math
import re
from collections import defaultdict


SCHEMA_VERSION = 1
MAX_COMPONENTS = 300
MAX_WIRES = 1200
MAX_PACKAGE_DEPTH = 12
MAX_SIM_STEPS = 32
IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
PACKAGE_NAME = re.compile(r"^pkg:([a-z][a-z0-9_]{1,39})@([1-9][0-9]{0,6})$")
MAX_POSITION = 10000


class CircuitError(ValueError):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


def pin(name, direction, width=1):
    return {"name": name, "direction": direction, "width": width}


def item(name, family, inputs=(), outputs=()):
    return {"name": name, "family": family,
            "pins": [pin(x, "in") for x in inputs]
                    + [pin(x, "out") for x in outputs]}


COMPONENTS = {
    "input": item("外部输入开关", "io", outputs=("out",)),
    "output": item("外部输出灯", "io", inputs=("in",)),
    "vdd": item("电源高电平", "transistor", outputs=("out",)),
    "gnd": item("接地低电平", "transistor", outputs=("out",)),
    "junction": item("电气汇流节点", "transistor", inputs=("a", "b", "c", "d"),
                     outputs=("out",)),
    "nmos": item("NMOS开关", "transistor", inputs=("gate", "source"),
                 outputs=("drain",)),
    "pmos": item("PMOS开关", "transistor", inputs=("gate", "source"),
                 outputs=("drain",)),
    "not": item("非门", "gate", inputs=("in",), outputs=("out",)),
    "nand": item("与非门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "nor": item("或非门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "and": item("与门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "or": item("或门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "xor": item("异或门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "xnor": item("同或门", "gate", inputs=("in1", "in2"), outputs=("out",)),
    "mux2": item("二选一多路器", "gate", inputs=("a", "b", "sel"),
                 outputs=("out",)),
    "sr_latch": item("高有效SR锁存器", "sequential", inputs=("s", "r"),
                     outputs=("q", "qbar")),
    "dff": item("上升沿D触发器", "sequential", inputs=("d", "clk"),
                outputs=("q", "qbar")),
}
# Read-only API consumers must not be able to modify the canonical registry.


def is_bit(value):
    return type(value) is int and value in (0, 1)


def _fail(code, message):
    raise CircuitError(code, message)


def _external_pins(pins):
    if not isinstance(pins, dict):
        _fail("INVALID_INTERFACE", "关卡输入与输出须为对象")
    result = {}
    for key in ("inputs", "outputs"):
        group = pins.get(key)
        if not isinstance(group, list) or not group or len(group) > 32:
            _fail("INVALID_INTERFACE", "封装接口必须声明有序的输入、输出引脚")
        names = []
        for x in group:
            if not isinstance(x, dict) or not isinstance(x.get("name"), str):
                _fail("INVALID_INTERFACE", "接口引脚缺少名称")
            if (not IDENT.fullmatch(x["name"])
                or type(x.get("width",1)) is not int or x.get("width",1)!=1):
                _fail("INVALID_INTERFACE", "接口引脚名称或位宽不合法")
            names.append(x["name"])
        if len(set(names)) != len(names):
            _fail("DUPLICATE_PIN", "封装接口有同名引脚")
        result[key] = names
    if set(result["inputs"]) & set(result["outputs"]):
        _fail("DUPLICATE_PIN", "接口输入输出名称不能重复")
    return result


def make_pins(interface):
    names = _external_pins(interface)
    return [pin(x, "in") for x in names["inputs"]] + [
        pin(x, "out") for x in names["outputs"]
    ]


def type_info(type_name, packages):
    if type_name in COMPONENTS:
        return COMPONENTS[type_name]
    match = PACKAGE_NAME.fullmatch(type_name) if isinstance(type_name, str) else None
    if match:
        definition = packages.get(type_name)
        if definition is None:
            _fail("PACKAGE_LOCKED", f"元件未解锁或版本不可用：{type_name}")
        return {"name": definition["name"], "family": "package",
                "pins": make_pins(definition["interface"])}
    _fail("UNKNOWN_COMPONENT", f"未知元件类型：{type_name}")


def validate_graph(graph, packages=None, allowed=None, interface=None):
    """Validate all nodes/ports/edges. Return independent, sanitized topology."""
    packages = packages or {}
    if not isinstance(graph, dict):
        _fail("INVALID_CIRCUIT", "电路图必须是JSON对象")
    if graph.get("schemaVersion") != SCHEMA_VERSION or type(graph.get("schemaVersion")) is not int:
        _fail("CIRCUIT_SCHEMA_MISMATCH",
              f"电路结构版本不兼容：只接受schemaVersion={SCHEMA_VERSION}")
    raw_components, raw_wires = graph.get("components"), graph.get("wires")
    if not isinstance(raw_components, list) or not isinstance(raw_wires, list):
        _fail("INVALID_CIRCUIT", "电路图必须有components和wires数组")
    if len(raw_components) > MAX_COMPONENTS or len(raw_wires) > MAX_WIRES:
        _fail("CIRCUIT_TOO_LARGE", "电路超出300个元件或1200条连线限制")
    comps, by_id, shapes, inputs, outputs = [], {}, {}, [], []
    for n, raw in enumerate(raw_components):
        if not isinstance(raw, dict):
            _fail("INVALID_COMPONENT", f"元件{n}不是对象")
        comp_id, kind = raw.get("id"), raw.get("type")
        if not isinstance(comp_id, str) or not IDENT.fullmatch(comp_id):
            _fail("INVALID_COMPONENT", f"元件{n}编号不合法")
        if comp_id in by_id:
            _fail("DUPLICATE_COMPONENT", f"重复元件编号：{comp_id}")
        if not isinstance(kind, str):
            _fail("INVALID_COMPONENT", f"元件{comp_id}缺少type")
        shape = type_info(kind, packages)
        if allowed is not None:
            base = PACKAGE_NAME.fullmatch(kind)
            permitted = kind in allowed.get("types", ()) if not base else (
                base.group(1) in allowed.get("packages", ())
            )
            if not permitted:
                _fail("COMPONENT_FORBIDDEN", f"本关不允许使用元件：{kind}")
        x, y = raw.get("x", 0), raw.get("y", 0)
        if (type(x) not in (int, float) or type(y) not in (int, float)
            or not math.isfinite(x) or not math.isfinite(y)
            or abs(x) > MAX_POSITION or abs(y) > MAX_POSITION):
            _fail("INVALID_POSITION", f"{comp_id}坐标不合法")
        rotation = raw.get("rotation", 0)
        if type(rotation) is not int or rotation not in (0, 90, 180, 270):
            _fail("INVALID_ROTATION", f"{comp_id}旋转角度须为0、90、180或270度")
        clean = {"id": comp_id, "type": kind, "x": x, "y": y}
        if rotation:
            clean["rotation"] = rotation
        if kind in ("input", "output"):
            name = raw.get("name")
            if not isinstance(name, str) or not IDENT.fullmatch(name):
                _fail("INVALID_INTERFACE", f"{comp_id}的外部端口名称不合法")
            clean["name"] = name
            (inputs if kind == "input" else outputs).append(name)
        elif "name" in raw:
            _fail("INVALID_COMPONENT", "只有外部输入输出元件允许name")
        if set(raw) - {"id", "type", "x", "y", "name", "rotation"}:
            _fail("INVALID_COMPONENT", f"元件{comp_id}包含未知字段")
        by_id[comp_id], shapes[comp_id] = clean, shape
        comps.append(clean)
    if len(inputs) != len(set(inputs)) or len(outputs) != len(set(outputs)):
        _fail("DUPLICATE_INTERFACE", "外部输入或输出名称重复")
    if interface:
        expected = _external_pins(interface)
        if set(inputs) != set(expected["inputs"]) or set(outputs) != set(expected["outputs"]):
            _fail("INTERFACE_MISMATCH", "图中的外部输入/输出必须与关卡固定引脚完全一致")
    # schemaVersion=1 keeps the historical from/to field names, but a wire
    # represents an undirected copper connection.  Two terminals on one net
    # can be attached regardless of pin direction; driving conflicts belong
    # to the electrical rule checker, not the drawing tool.
    wires, seen_edges = [], set()
    for index, raw in enumerate(raw_wires):
        if not isinstance(raw, dict) or set(raw) != {"from", "to"}:
            _fail("INVALID_WIRE", f"连线{index}格式不合法")
        points = []
        for side in ("from", "to"):
            endpoint = raw.get(side)
            if not isinstance(endpoint, dict) or set(endpoint) != {"comp", "pin"}:
                _fail("INVALID_WIRE", f"连线{index}端点{side}格式不合法")
            comp_id, pname = endpoint.get("comp"), endpoint.get("pin")
            if not isinstance(comp_id, str) or comp_id not in by_id:
                _fail("UNKNOWN_COMPONENT", f"连线端点不存在：{comp_id}")
            info = next((x for x in shapes[comp_id]["pins"] if x["name"] == pname), None)
            if info is None:
                _fail("UNKNOWN_PIN", f"{comp_id}.{pname}引脚不存在")
            points.append((comp_id, pname, info["width"]))
        if points[0][:2] == points[1][:2]:
            _fail("INVALID_WIRE", "不能将一个引脚连接到自身")
        if points[0][2] != points[1][2]:
            _fail("WIDTH_MISMATCH", "连线两端位宽必须相同")
        edge_key = frozenset((points[0][:2], points[1][:2]))
        if edge_key in seen_edges:
            _fail("DUPLICATE_WIRE", "同一对引脚不需要重复连接")
        seen_edges.add(edge_key)
        wires.append({"from": {"comp": points[0][0], "pin": points[0][1]},
                      "to": {"comp": points[1][0], "pin": points[1][1]}})

    return {"schemaVersion": SCHEMA_VERSION, "components": comps, "wires": wires}


def _invert(value):
    return 1 - value if is_bit(value) else "X"


def _gate_result(kind, values):
    """Four-state-aware gates. Z at an input is an unknown logic level."""
    values = [x if is_bit(x) else "X" for x in values]
    def _and(args):
        if 0 in args:
            return 0
        return 1 if all(x == 1 for x in args) else "X"
    def _or(args):
        if 1 in args:
            return 1
        return 0 if all(x == 0 for x in args) else "X"
    if kind == "not":
        return _invert(values[0])
    if kind == "nand":
        return _invert(_and(values))
    if kind == "nor":
        return _invert(_or(values))
    if kind == "and":
        return _and(values)
    if kind == "or":
        return _or(values)
    if kind == "xor":
        return values[0] ^ values[1] if all(is_bit(v) for v in values) else "X"
    if kind == "xnor":
        return int(values[0] == values[1]) if all(is_bit(v) for v in values) else "X"
    if kind == "mux2":
        if is_bit(values[2]):
            return values[values[2]]
        return values[0] if values[0] == values[1] and is_bit(values[0]) else "X"
    _fail("UNKNOWN_COMPONENT", "不支持的逻辑门")


class DSU:
    def __init__(self, points):
        self.parent = {x: x for x in points}

    def find(self, key):
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def join(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def _check_cycles(graph):
    """Find combinational feedback across nets, including junctions and reversed wires."""
    nodes = {x["id"]: x for x in graph["components"]}
    logic = {"nand", "nor", "and", "or", "xor", "not", "xnor", "mux2"}
    points = [(c["id"], p["name"]) for c in graph["components"]
              for p in COMPONENTS.get(c["type"], {}).get("pins", [])]
    # Packages are not part of the static gate-level SCC check, as their
    # internal transistor network has already been checked by simulation.
    net = DSU(points)
    for w in graph["wires"]:
        a, b = w["from"], w["to"]
        pa, pb = (a["comp"], a["pin"]), (b["comp"], b["pin"])
        if pa in net.parent and pb in net.parent:
            net.join(pa, pb)
    for cid, c in nodes.items():
        if c["type"] == "junction":
            for p in ("a", "b", "c", "d"):
                net.join((cid, "out"), (cid, p))
    sources, sinks = defaultdict(set), defaultdict(set)
    for point in points:
        cid, pname = point
        if nodes[cid]["type"] not in logic:
            continue
        direction = next((p["direction"] for p in COMPONENTS[nodes[cid]["type"]]["pins"]
                          if p["name"] == pname), None)
        (sources if direction == "out" else sinks)[net.find(point)].add(cid)
    edges = defaultdict(set)
    for root, outgoing in sources.items():
        for src in outgoing:
            edges[src].update(sinks[root])
    serial, stack, onstack, index, low, bad = [0], [], set(), {}, {}, []
    def visit(v):
        index[v] = low[v] = serial[0]
        serial[0] += 1
        stack.append(v)
        onstack.add(v)
        for w in edges[v]:
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in onstack:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            component = set()
            while True:
                w = stack.pop()
                onstack.remove(w)
                component.add(w)
                if w == v:
                    break
            cyc = len(component) > 1 or v in edges[v]
            if cyc:
                if len(component) == 2:
                    a, b = tuple(component)
                    good = (nodes[a]["type"] == nodes[b]["type"]
                            and nodes[a]["type"] in ("nand", "nor")
                            and b in edges[a] and a in edges[b])
                    if not good:
                        bad.append(sorted(component))
                else:
                    bad.append(sorted(component))
    for v in list(edges):
        if v not in index:
            visit(v)
    return bad


def complexity(graph, packages, stack=()):
    """Bound recursively expanded work, including immutable nested packages."""
    total=0
    for comp in graph["components"]:
        total+=1
        kind=comp["type"]
        if isinstance(kind,str) and kind.startswith("pkg:"):
            if kind in stack:
                _fail("PACKAGE_CYCLE","封装定义存在递归引用")
            definition=packages.get(kind)
            if not definition:
                _fail("PACKAGE_LOCKED","封装元件缺失")
            if len(stack)>=MAX_PACKAGE_DEPTH:
                _fail("PACKAGE_DEPTH","元件嵌套层级过深")
            total+=complexity(definition["graph"],packages,stack+(kind,))
        if total>2500:
            _fail("CIRCUIT_TOO_LARGE","封装展开后超出2500个元件的模拟限制")
    return total


def _read_signal(value):
    if not is_bit(value):
        _fail("INVALID_SIGNAL", "输入和时序状态仅允许整数0或1")
    return value


def _read_state(state):
    if state is None:
        return {"memory": {}, "nodes": {}, "packages": {}}
    if not isinstance(state, dict):
        _fail("INVALID_SIMULATION_STATE", "时序状态必须是JSON对象")
    try:
        encoded_size=len(json.dumps(state,ensure_ascii=False).encode("utf-8"))
    except (ValueError, TypeError, RecursionError, OverflowError):
        _fail("INVALID_SIMULATION_STATE","时序状态无法序列化")
    if encoded_size>256_000:
        _fail("INVALID_SIMULATION_STATE","时序模拟状态不能超过256KB")
    if set(state) - {"memory", "nodes", "packages"}:
        _fail("INVALID_SIMULATION_STATE", "时序状态包含未知字段")
    result = {}
    for key in ("memory", "nodes", "packages"):
        value = state.get(key, {})
        if not isinstance(value, dict) or len(value) > 300:
            _fail("INVALID_SIMULATION_STATE", f"模拟状态{key}不是有限映射")
        result[key] = copy.deepcopy(value)
    for value in result["memory"].values():
        if not (is_bit(value) or value == "X"):
            _fail("INVALID_SIMULATION_STATE", "存储状态仅支持0、1或X")
    for value in result["nodes"].values():
        if not (is_bit(value) or value in ("X", "Z")):
            _fail("INVALID_SIMULATION_STATE", "节点状态仅支持0、1、X或Z")
    return result


def _unconnected(graph, shapes):
    used = {(w[side]["comp"], w[side]["pin"])
            for w in graph["wires"] for side in ("from", "to")}
    warnings = []
    for c in graph["components"]:
        shape = shapes[c["id"]]
        for p in shape["pins"]:
            if p["direction"] == "in" and (c["id"], p["name"]) not in used:
                if c["type"] == "junction":  # junction has optional contact positions
                    continue
                warnings.append({"code": "FLOATING_PIN",
                                 "message": f"{c['id']}.{p['name']}未接线，输入为高阻态Z",
                                 "component": c["id"], "pin": p["name"]})
    return warnings


def simulate(graph, inputs=None, state=None, cycles=0, packages=None,
             _depth=0, _validated=False):
    """Return output values, per-pin values, warnings, and caller-owned state.

    cycles=0: live combinational evaluation, do not advance memory.
    cycles=N: N ideal clock steps; update SR latch and DFF once per step.
    """
    if type(cycles) is not int or not 0 <= cycles <= MAX_SIM_STEPS:
        _fail("INVALID_CYCLES", f"每次模拟最多{MAX_SIM_STEPS}个时钟周期")
    if _depth > MAX_PACKAGE_DEPTH:
        _fail("PACKAGE_DEPTH", "封装元件嵌套过深")
    packages = packages or {}
    graph = graph if _validated else validate_graph(graph, packages)
    if _depth==0:
        complexity(graph,packages)
    state = _read_state(state)
    inputs = inputs if inputs is not None else {}
    if not isinstance(inputs, dict):
        _fail("INVALID_SIGNAL", "inputs必须是对象")
    comps = {c["id"]: c for c in graph["components"]}
    shapes = {x: type_info(c["type"], packages) for x, c in comps.items()}
    known_inputs = {c["name"] for c in comps.values() if c["type"] == "input"}
    for k, v in inputs.items():
        if k not in known_inputs:
            _fail("UNKNOWN_INPUT", f"未知外部输入：{k}")
        _read_signal(v)
    warnings = _unconnected(graph, shapes)
    nested_warning_seen = set()
    def collect_nested(component_id, child):
        # Surface warnings in frozen subcircuits, but count each pin only once
        # even if internal simulation runs dozens of settle iterations.
        for warning in child["warnings"]:
            item=dict(warning)
            item["component"]=f"{component_id}/{item.get('component', '')}".rstrip("/")
            key=(item["code"],item["component"],item.get("pin"))
            if key not in nested_warning_seen:
                nested_warning_seen.add(key)
                warnings.append(item)
    for name in sorted(known_inputs - set(inputs)):
        warnings.append({"code": "MISSING_EXTERNAL_INPUT",
                         "message": f"输入{name}未提供，按0处理"})
    invalid_cycles = _check_cycles(graph)
    # Build the pin-level network. Wires only join a signal net; transistor
    # terminal connections are added dynamically when the switch conducts.
    points = [(cid, p["name"]) for cid, shape in shapes.items()
              for p in shape["pins"]]
    drivers = {(cid, p["name"]): 0 for cid, shape in shapes.items()
               for p in shape["pins"] if p["direction"] == "out"}
    for cid, comp in comps.items():
        kind = comp["type"]
        if kind == "input":
            drivers[(cid, "out")] = inputs.get(comp["name"], 0)
        elif kind == "vdd":
            drivers[(cid, "out")] = 1
        elif kind == "gnd":
            drivers[(cid, "out")] = 0
        elif kind == "sr_latch":
            value = state["memory"].get(cid, 0)
            drivers[(cid, "q")] = value  # _read_state already checked 0/1/X
            drivers[(cid, "qbar")] = _invert(value)
        elif kind == "dff":
            value = state["memory"].get(cid, 0)
            drivers[(cid, "q")] = value  # _read_state already checked 0/1/X
            drivers[(cid, "qbar")] = _invert(value)
        elif kind in ("nmos", "pmos", "junction"):
            drivers.pop((cid, "drain" if kind != "junction" else "out"), None)
        elif kind in ("not", "nand", "nor", "and", "or", "xor", "xnor", "mux2"):
            drivers[(cid, "out")] = state["nodes"].get(f"{cid}.out", 0)
        elif PACKAGE_NAME.fullmatch(kind):
            pins = [p["name"] for p in shapes[cid]["pins"]
                    if p["direction"] == "out"]
            for pname in pins:
                drivers[(cid, pname)] = state["nodes"].get(f"{cid}.{pname}", 0)

    def settle(initial_drivers):
        pin_values = {point: "Z" for point in points}
        on = {}
        seen = set()
        local_drivers = dict(initial_drivers)
        conflicts = []
        driver_conflicts = []
        unknown_gates = []
        unstable = bool(invalid_cycles)
        for _ in range(64):
            net = DSU(points)
            for w in graph["wires"]:
                net.join((w["from"]["comp"], w["from"]["pin"]),
                         (w["to"]["comp"], w["to"]["pin"]))
            on = {}
            unknown_gates = []
            for cid, comp in comps.items():
                kind = comp["type"]
                if kind == "junction":
                    members = [(cid, pname) for pname in ("a", "b", "c", "d", "out")]
                    for endpoint in members[1:]:
                        net.join(members[0], endpoint)
                elif kind in ("nmos", "pmos"):
                    gate_value = pin_values[(cid, "gate")]
                    if not is_bit(gate_value):
                        # The transistor might conduct; never silently treat
                        # an unknown gate as a definite disabled switch.
                        unknown_gates.append(cid)
                        on[cid] = "X"
                    else:
                        active = gate_value == (1 if kind == "nmos" else 0)
                        on[cid] = int(active)
                        if active:
                            net.join((cid, "source"), (cid, "drain"))
            connected, drive_points = defaultdict(set), defaultdict(set)
            for point, bit in local_drivers.items():
                if bit != "Z":
                    root = net.find(point)
                    connected[root].add(bit)
                    drive_points[root].add(point)
            new_values, conflicts, driver_conflicts = {}, [], []
            for point in points:
                root = net.find(point)
                bits = connected[root]
                if 0 in bits and 1 in bits:
                    conflicts.append(point)
                if len(drive_points[root]) > 1:
                    drivers_here = {comps[cid]["type"] for cid, _ in drive_points[root]}
                    # Several GND or VDD symbols represent one shared rail.
                    if drivers_here not in ({"vdd"}, {"gnd"}):
                        driver_conflicts.append(point)
                if not bits:
                    new_values[point] = "Z"
                elif "X" in bits or (0 in bits and 1 in bits):
                    new_values[point] = "X"
                else:
                    new_values[point] = next(iter(bits))
            new_drivers = dict(local_drivers)
            for cid, comp in comps.items():
                kind = comp["type"]
                info = shapes[cid]["pins"]
                if kind in ("not", "nand", "nor", "and", "or", "xor", "xnor", "mux2"):
                    args = [new_values[(cid, p["name"])] for p in info
                            if p["direction"] == "in"]
                    new_drivers[(cid, "out")] = _gate_result(kind, args)
                elif PACKAGE_NAME.fullmatch(kind):
                    child_inputs = {p["name"]: new_values[(cid, p["name"])]
                                    for p in info if p["direction"] == "in"}
                    if all(is_bit(v) for v in child_inputs.values()):
                        result = simulate(packages[kind]["graph"], child_inputs,
                                          state["packages"].get(cid),
                                          cycles=0, packages=packages,
                                          _depth=_depth+1)
                        for pname, bit in result["outputs"].items():
                            new_drivers[(cid, pname)] = bit
                        collect_nested(cid,result)
                        if result["unstable"]:
                            nonlocal_unstable[0] = True
                    else:
                        for p in info:
                            if p["direction"] == "out":
                                new_drivers[(cid, p["name"])] = "X"
            signature = (
                tuple((key, new_drivers[key]) for key in sorted(new_drivers)),
                tuple((key, new_values[key]) for key in sorted(new_values)),
                tuple(sorted(on.items())),
            )
            if new_drivers == local_drivers and new_values == pin_values:
                pin_values = new_values
                local_drivers = new_drivers
                break
            if signature in seen:
                unstable = True
                pin_values = new_values
                local_drivers = new_drivers
                break
            seen.add(signature)
            pin_values, local_drivers = new_values, new_drivers
        else:
            unstable = True
        return pin_values, local_drivers, conflicts, driver_conflicts, unknown_gates, unstable

    nonlocal_unstable = [False]
    def tick_step(previous_drivers):
        pinvals, driven, conflicts, driver_conflicts, unknown_gates, unstable = settle(previous_drivers)
        next_memory = dict(state["memory"])
        next_packages = dict(state["packages"])
        for cid, comp in comps.items():
            kind = comp["type"]
            if kind == "sr_latch":
                s, r = pinvals[(cid, "s")], pinvals[(cid, "r")]
                if not is_bit(s) or not is_bit(r):
                    next_memory[cid] = "X"
                elif s and r:
                    raise CircuitError("INVALID_LATCH_INPUT", "SR锁存器不能同时置位和复位")
                elif s or r:
                    next_memory[cid] = int(s)
                else:
                    next_memory.setdefault(cid, 0)
            elif kind == "dff":
                current_clk = pinvals[(cid, "clk")]
                previous_clk = state["nodes"].get(f"{cid}.clk", 0)
                if not is_bit(current_clk) or not is_bit(previous_clk):
                    next_memory[cid] = "X"
                elif current_clk and not previous_clk:
                    data = pinvals[(cid, "d")]
                    next_memory[cid] = data if is_bit(data) else "X"
                else:
                    next_memory.setdefault(cid, 0)
                state["nodes"][f"{cid}.clk"] = current_clk
            elif PACKAGE_NAME.fullmatch(kind):
                pkg_inputs = {p["name"]: pinvals[(cid, p["name"])]
                              for p in shapes[cid]["pins"] if p["direction"] == "in"}
                if all(is_bit(v) for v in pkg_inputs.values()):
                    result = simulate(packages[kind]["graph"], pkg_inputs,
                                      state["packages"].get(cid), cycles=1,
                                      packages=packages, _depth=_depth+1)
                    next_packages[cid] = result["state"]
                    collect_nested(cid,result)
                    if result["unstable"]:
                        nonlocal_unstable[0] = True
                else:
                    nonlocal_unstable[0] = True
        state["memory"] = next_memory
        state["packages"] = next_packages
        for cid, comp in comps.items():
            kind = comp["type"]
            if kind in ("sr_latch", "dff"):
                value = next_memory.get(cid, 0)
                driven[(cid, "q")] = value
                driven[(cid, "qbar")] = _invert(value)
            elif PACKAGE_NAME.fullmatch(kind):
                pins = [p["name"] for p in shapes[cid]["pins"]
                        if p["direction"] == "in"]
                child_inputs = {pname: pinvals[(cid, pname)] for pname in pins}
                if all(is_bit(v) for v in child_inputs.values()):
                    result = simulate(packages[kind]["graph"], child_inputs,
                                      next_packages.get(cid), cycles=0,
                                      packages=packages, _depth=_depth+1)
                    collect_nested(cid,result)
                    if result["unstable"]:
                        nonlocal_unstable[0] = True
                    for pname, bit in result["outputs"].items():
                        driven[(cid, pname)] = bit
                else:
                    for p in shapes[cid]["pins"]:
                        if p["direction"] == "out":
                            driven[(cid, p["name"])] = "X"
        return driven, unstable

    current = drivers
    unstable_in_ticks = False
    for _ in range(cycles):
        current, flagged = tick_step(current)
        unstable_in_ticks |= flagged
    values, current, conflicts, driver_conflicts, unknown_gates, unstable = settle(current)
    unstable |= unstable_in_ticks or nonlocal_unstable[0]
    if conflicts:
        warnings.append({"code": "SHORT_CIRCUIT",
                         "message": "导通网络出现高低电平短接，输出无法稳定"})
        unstable = True
    if driver_conflicts:
        warnings.append({"code": "MULTIPLE_OUTPUT_DRIVERS",
                         "message": "同一网络连接了多个主动输出，请使用一个驱动源或隔离元件"})
        unstable = True
    if unknown_gates:
        warnings.append({"code": "UNKNOWN_TRANSISTOR_GATE",
                         "message": "晶体管栅极电平不确定，无法安全判定导通"})
        unstable = True
    if invalid_cycles:
        warnings.append({"code": "UNSUPPORTED_FEEDBACK",
                         "message": "存在非锁存器结构的门电路反馈，输出无法稳定"})
    if unstable and not any(x["code"] == "UNSTABLE" for x in warnings):
        warnings.append({"code": "UNSTABLE", "message": "输出无法稳定"})
    for (cid, pname), bit in current.items():
        if pname not in ("gate", "source", "drain"):
            if shapes[cid]["family"] == "gate" or shapes[cid]["family"] == "package":
                state["nodes"][f"{cid}.{pname}"] = bit
    # Only wires/actual electricity carry values; unused junction input ports
    # are intentionally ignored in warning generation.
    pins = {cid: {p["name"]: values[(cid, p["name"])]
                  for p in shapes[cid]["pins"]} for cid in comps}
    outputs = {c["name"]: values[(c["id"], "in")] for c in comps.values()
               if c["type"] == "output"}
    for c in comps.values():
        if c["type"] != "output":
            continue
        level = outputs[c["name"]]
        if level in ("Z", "X"):
            warnings.append({"code": "UNDRIVEN_OUTPUT" if level == "Z" else "UNKNOWN_OUTPUT",
                             "message": f"输出{c['name']}为{level}，不是有效的0/1电平",
                             "component": c["id"], "pin": "in"})
            if level == "X":
                unstable = True
    return {"outputs": outputs, "pins": pins, "state": state,
            "warnings": warnings, "unstable": bool(unstable)}
