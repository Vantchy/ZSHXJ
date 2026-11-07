"""Electrical and scoring regression tests for the existing schema-1 course."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import circuit_engine as ce
import circuit_service as service
import level_content as content


def fixture(name):
    return json.loads((ROOT / "tests" / "circuit_fixtures" / f"{name}.json").read_text())


def comp(cid, kind, **extra):
    return {"id": cid, "type": kind, "x": 0, "y": 0, **extra}


def wire(a, ap, b, bp):
    return {"from": {"comp": a, "pin": ap}, "to": {"comp": b, "pin": bp}}


def graph(components, wires):
    return {"schemaVersion": 1, "components": components, "wires": wires}


def level(name):
    return next(spec for spec in content.installed_specs() if spec["id"] == name)


class ElectricalRegressionTests(unittest.TestCase):
    def test_pmos_only_inverter_cannot_pass(self):
        circuit = fixture("cmos_not")
        circuit["components"] = [c for c in circuit["components"] if c["id"] != "N"]
        circuit["wires"] = [w for w in circuit["wires"] if w["from"]["comp"] != "N"
                             and w["to"]["comp"] != "N"]
        result = service._grade(level("ch1_cmos_not"), ce.validate_graph(circuit), {})
        self.assertFalse(result["completed"])
        self.assertEqual((result["passedCount"], result["totalCount"]), (1, 2))
        self.assertEqual(result["firstFailure"]["actualOutputs"]["Y"], "Z")
        self.assertIn("UNDRIVEN_OUTPUT", [warning["code"] for warning in result["warnings"]])

    def test_two_pmos_nand_cannot_pass(self):
        circuit = fixture("cmos_nand")
        transistor_ids = {c["id"] for c in circuit["components"] if c["type"] == "nmos"}
        circuit["components"] = [c for c in circuit["components"] if c["id"] not in transistor_ids]
        circuit["wires"] = [w for w in circuit["wires"] if
                            w["from"]["comp"] not in transistor_ids and
                            w["to"]["comp"] not in transistor_ids]
        result = service._grade(level("ch1_cmos_nand"), ce.validate_graph(circuit), {})
        self.assertFalse(result["completed"])
        self.assertEqual(result["passedCount"], 3)
        self.assertEqual(result["firstFailure"]["actualOutputs"]["Y"], "Z")

    def test_two_wires_can_land_on_one_lamp_terminal(self):
        circuit = graph([comp("A", "input", name="A"), comp("B", "input", name="B"),
                         comp("Y", "output", name="Y")], [
            wire("A", "out", "Y", "in"), wire("B", "out", "Y", "in")])
        self.assertEqual(len(ce.validate_graph(circuit)["wires"]), 2)
        output = ce.simulate(circuit, {"A": 0, "B": 1})
        self.assertEqual(output["outputs"], {"Y": "X"})
        self.assertTrue(output["unstable"])
        self.assertIn("SHORT_CIRCUIT", [w["code"] for w in output["warnings"]])
        equal = ce.simulate(circuit, {"A": 1, "B": 1})
        self.assertIn("MULTIPLE_OUTPUT_DRIVERS", [w["code"] for w in equal["warnings"]])

    def test_reversed_wiring_resolves_the_same_net(self):
        circuit = graph([comp("A", "input", name="A"), comp("G", "not"),
                         comp("Y", "output", name="Y")], [
            wire("G", "in", "A", "out"), wire("Y", "in", "G", "out")])
        self.assertEqual(ce.simulate(circuit, {"A": 0})["outputs"], {"Y": 1})
        self.assertEqual(ce.simulate(circuit, {"A": 1})["outputs"], {"Y": 0})
        self.assertEqual(ce.validate_graph(circuit)["wires"], circuit["wires"])

    def test_floating_gate_input_uses_unknown_not_zero(self):
        circuit = graph([comp("G", "not"), comp("Y", "output", name="Y")],
                        [wire("G", "out", "Y", "in")])
        result = ce.simulate(circuit)
        self.assertEqual(result["outputs"], {"Y": "X"})
        self.assertIn("FLOATING_PIN", [w["code"] for w in result["warnings"]])
        self.assertIn("UNKNOWN_OUTPUT", [w["code"] for w in result["warnings"]])
        self.assertEqual(ce._gate_result("and", [0, "Z"]), 0)
        self.assertEqual(ce._gate_result("and", [1, "Z"]), "X")
        self.assertEqual(ce._gate_result("or", [1, "X"]), 1)
        self.assertEqual(ce._gate_result("xor", [0, "X"]), "X")
        self.assertEqual(ce._gate_result("mux2", [1, 1, "Z"]), 1)

    def test_junction_unites_arbitrary_ends_and_fans_out(self):
        circuit = graph([
            comp("A", "input", name="A"),comp("J", "junction"),
            comp("Y", "output", name="Y"), comp("Z", "output", name="Z")
        ], [wire("A", "out", "J", "out"),
            wire("J", "a", "Y", "in"), wire("Z", "in", "J", "out")])
        for value in (0, 1):
            self.assertEqual(ce.simulate(circuit, {"A": value})["outputs"],
                             {"Y": value, "Z": value})
        half = level("ch1_half_adder")
        allowed = service._allowed(half)
        self.assertIn("junction", allowed["types"])
        self.assertIn("junction", content.public_spec(half)["allowedTypes"])

    def test_rotation_is_layout_only_and_schema_one_stays_valid(self):
        circuit = fixture("half_adder")
        baseline = {tuple(sorted(inputs.items())): ce.simulate(circuit, inputs)["outputs"]
                    for inputs in ({"A": a, "B": b} for a in (0, 1) for b in (0, 1))}
        for angle in (0, 90, 180, 270):
            changed = copy.deepcopy(circuit)
            for i, c in enumerate(changed["components"]):
                c["x"] = i*45-100
                c["y"] = 85-i*17
                if angle:
                    c["rotation"] = angle
            clean = ce.validate_graph(changed)
            self.assertEqual(clean["schemaVersion"], 1)
            self.assertEqual(
                {tuple(sorted(inputs.items())): ce.simulate(clean, inputs)["outputs"]
                 for inputs in ({"A": a, "B": b} for a in (0,1) for b in (0,1))},baseline)
        changed["components"][0]["rotation"] = 42
        with self.assertRaises(ce.CircuitError) as exc:
            ce.validate_graph(changed)
        self.assertEqual(exc.exception.code, "INVALID_ROTATION")

    def test_cycle_through_junction_is_detected(self):
        circuit = graph([comp("G", "not"),comp("J", "junction"),
                         comp("Y", "output", name="Y")], [
            wire("G", "out", "J", "a"),wire("J", "out", "G", "in"),
            wire("G", "out", "Y", "in")])
        result = ce.simulate(circuit)
        self.assertTrue(result["unstable"])
        self.assertIn("UNSUPPORTED_FEEDBACK", [w["code"] for w in result["warnings"]])

    def test_unknown_sequential_state_round_trips_without_crash(self):
        circuit = graph([comp("F", "dff"), comp("Y", "output", name="Y")],
                        [wire("F", "q", "Y", "in")])
        first = ce.simulate(circuit, {}, cycles=1)  # floating clock / data
        self.assertEqual(first["outputs"]["Y"], "X")
        self.assertEqual(first["state"]["memory"]["F"], "X")
        second = ce.simulate(circuit, {}, state=first["state"], cycles=0)
        self.assertEqual(second["outputs"]["Y"], "X")

    def test_correct_sequential_script_still_passes_with_existing_packages(self):
        # Explicit regression for the original shared-state script grader.
        circuit = fixture("sr_latch")
        definition = {"pkg:cmos_nand@1": {
            "name": "nand", "graph": fixture("cmos_nand"),
            "interface": {"inputs": [{"name": "A"}, {"name": "B"}],
                          "outputs": [{"name": "Y"}]}
        }}
        result = service._grade(level("ch1_sr_latch"), ce.validate_graph(circuit, definition), definition)
        self.assertTrue(result["completed"], result["firstFailure"])
        self.assertEqual(result["totalCount"], 4)
        self.assertEqual(result["unit"], "步")


if __name__ == "__main__":
    unittest.main()
