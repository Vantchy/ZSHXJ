"""固定教具目录：通关解锁官方元件，不把学生提交的电路实时封装成元件。

旧版个人封装由 level_content.owned 继续读取，仅用于兼容已经保存的电路图。
新版正式元件使用固定的 pkg:<symbol>@9000000 内部编号，以防与旧存档版本冲突。
玩家不会看到“封装”编号或任何内部预览。
"""
from __future__ import annotations

from contextlib import closing
import hashlib
import json

import circuit_engine as engine

FIXED_VERSION = 9000000
# Only canonical, reviewed logical functions. No user-authored graph is used.
FIXED_NAMES = {
    'cmos_not': '非门', 'cmos_nand': '与非门',
    'army_not': '非门', 'army_and': '与门', 'army_or': '或门',
    'army_nor': '或非门', 'army_xor': '异或门', 'army_xnor': '同或门',
    'yin_majority': '三人表决器', 'yin_mux2': '二选一选择器',
    'yin_mux4': '四选一选择器', 'yin_halfadder': '半加器',
    'yin_fulladder': '全加器', 'yin_ripple4': '四位行波进位加法器',
    'yin_cla4': '四位超前进位加法器', 'yin_eightbit': '八位加法器',
    # 卯时正式教学：通过本关后才获得可在下一关调用的标准器件。
    'mao_rs': '低有效RS锁存器',
    'mao_d_latch': '门控D锁存器',
    'mao_edge_dff': '上升沿D触发器',
    'mao_register4': '四位同步寄存器',
}


class Circuit:
    def __init__(self, interface):
        self.interface = interface
        self.components = []
        self.wires = []
        self.inputs = {}
        self.outputs = {}
        for i, pin in enumerate(interface['inputs']):
            name = pin['name']
            cid = f'i{i}'
            self.inputs[name] = (cid, 'out')
            self.components.append({'id':cid,'type':'input','name':name,'x':0,'y':i*64})
        for i, pin in enumerate(interface['outputs']):
            name = pin['name']
            cid = f'o{i}'
            self.outputs[name] = (cid, 'in')
            self.components.append({'id':cid,'type':'output','name':name,'x':850,'y':i*64})
        self.number = 0

    def gate(self, kind, *sources):
        pins = {
            'not':['in'],
            'mux2':['a','b','sel'],
            'and':['in1','in2'],'or':['in1','in2'],'xor':['in1','in2'],
            'nor':['in1','in2'],'nand':['in1','in2'],'xnor':['in1','in2'],
        }[kind]
        if len(sources) != len(pins):
            raise ValueError(f'{kind}: wrong input count')
        self.number += 1
        cid = f'g{self.number}'
        self.components.append({'id':cid,'type':kind,
                                'x':100+(self.number%9)*68,
                                'y':100+(self.number//9)*74})
        for source, pin in zip(sources,pins):
            self.wire(source,(cid,pin))
        return (cid,'out')

    def wire(self, source, target):
        self.wires.append({'from':{'comp':source[0],'pin':source[1]},
                           'to':{'comp':target[0],'pin':target[1]}})

    def output(self, name, source):
        self.wire(source,self.outputs[name])

    def sequential(self, kind, incoming):
        # 标准 IEC 时序器件引脚：SR 的 s/r/q/qbar、DFF 的 d/clk/q/qbar。
        pins = {'sr_latch': {'s','r'}, 'dff': {'d','clk'}}
        if kind not in pins or set(incoming) != pins[kind]:
            raise ValueError('错误的时序器件引脚')
        self.number += 1
        cid = f'g{self.number}'
        self.components.append({'id':cid,'type':kind,
                                'x':100+(self.number%9)*68,
                                'y':100+(self.number//9)*74})
        for pin_name, source in incoming.items():
            self.wire(source,(cid,pin_name))
        return (cid,'q'),(cid,'qbar')

    def finish(self):
        return {'schemaVersion':1, 'components':self.components,'wires':self.wires}


def _adder(c, a, b, cin):
    p = c.gate('xor', a, b)
    g = c.gate('and', a, b)
    total = c.gate('xor', p, cin)
    carry = c.gate('or', g, c.gate('and', p, cin))
    return total, carry


def _or_all(c, sources):
    result = sources[0]
    for source in sources[1:]:
        result = c.gate('or', result, source)
    return result


def _and_all(c, sources):
    result = sources[0]
    for source in sources[1:]:
        result = c.gate('and', result, source)
    return result


def _build(symbol, interface):
    c = Circuit(interface)
    ins = [c.inputs[p['name']] for p in interface['inputs']]
    outs = [p['name'] for p in interface['outputs']]
    simple = {
        'cmos_not':'not', 'cmos_nand':'nand',
        'army_not':'not', 'army_and':'and', 'army_or':'or',
        'army_nor':'nor', 'army_xor':'xor', 'army_xnor':'xnor'
    }
    if symbol in simple:
        assert len(outs)==1
        c.output(outs[0],c.gate(simple[symbol], *ins))
    elif symbol=='yin_majority':
        assert len(ins)==3 and len(outs)==1
        a,b,d=ins
        c.output(outs[0], _or_all(c,[c.gate('and',a,b),c.gate('and',a,d),c.gate('and',b,d)]))
    elif symbol=='yin_mux2':
        assert len(ins)==3 and len(outs)==1
        c.output(outs[0],c.gate('mux2',*ins))
    elif symbol=='yin_mux4':
        assert len(ins)==6 and len(outs)==1
        a,b,d,e,s0,s1=ins
        c.output(outs[0],c.gate('mux2',c.gate('mux2',a,b,s0),c.gate('mux2',d,e,s0),s1))
    elif symbol=='yin_halfadder':
        assert len(ins)==2 and len(outs)==2
        a,b=ins
        c.output('S',c.gate('xor',a,b))
        c.output('Cout',c.gate('and',a,b))
    elif symbol=='yin_fulladder':
        assert len(ins)==3 and len(outs)==2
        s,carry=_adder(c,*ins)
        c.output('S',s)
        c.output('Cout',carry)
    elif symbol in ('yin_ripple4','yin_eightbit'):
        bits=4 if symbol=='yin_ripple4' else 8
        assert len(ins)==bits*2+1 and len(outs)==bits+1
        carry=c.inputs['Cin']
        for i in range(bits):
            summ,carry=_adder(c,c.inputs[f'A{i}'],c.inputs[f'B{i}'],carry)
            c.output(f'S{i}',summ)
        c.output('Cout',carry)
    elif symbol=='yin_cla4':
        assert len(ins)==9 and len(outs)==5
        carry0=c.inputs['Cin']
        g=[c.gate('and',c.inputs[f'A{i}'],c.inputs[f'B{i}']) for i in range(4)]
        p=[c.gate('xor',c.inputs[f'A{i}'],c.inputs[f'B{i}']) for i in range(4)]
        carry=[carry0]
        for i in range(4):
            # C(i+1) = Gi + Pi G(i-1) + ... + Pi...P0 C0
            terms=[]
            for j in range(i,-1,-1):
                terms.append(_and_all(c,[*p[j+1:i+1],g[j]]))
            terms.append(_and_all(c,[*p[:i+1],carry0]))
            carry.append(_or_all(c,terms))
            c.output(f'S{i}',c.gate('xor',p[i],carry[i]))
        c.output('Cout',carry[4])
    elif symbol == 'mao_rs':
        assert set(c.inputs)=={'Sbar','Rbar'} and set(c.outputs)=={'Q','Qbar'}
        # 低有效 NAND-RS 的等价官方模型。
        # 在学生作答时必须亲自接两只 NAND；官方复用器件则使用有
        # 明确初值的 SR 状态原件，避免反馈回路从未初始化状态振荡。
        set_high=c.gate('not',c.inputs['Sbar'])
        reset_high=c.gate('not',c.inputs['Rbar'])
        q,qbar=c.sequential('sr_latch',{'s':set_high,'r':reset_high})
        c.output('Q',q);c.output('Qbar',qbar)
    elif symbol == 'mao_d_latch':
        assert set(c.inputs)=={'D','EN'} and set(c.outputs) in ({'Q'},{'Q','Qbar'})
        not_d=c.gate('not',c.inputs['D'])
        set_high=c.gate('and',c.inputs['D'],c.inputs['EN'])
        reset_high=c.gate('and',not_d,c.inputs['EN'])
        q,qbar=c.sequential('sr_latch',{'s':set_high,'r':reset_high})
        c.output('Q',q)
        if 'Qbar' in c.outputs:
            c.output('Qbar',qbar) # 兼容旧版本只有 Q 的历史快照
    elif symbol == 'mao_edge_dff':
        assert set(c.inputs)=={'D','CLK'} and set(c.outputs) in ({'Q'},{'Q','Qbar'})
        q,qbar=c.sequential('dff',{'d':c.inputs['D'],'clk':c.inputs['CLK']})
        c.output('Q',q)
        if 'Qbar' in c.outputs:
            c.output('Qbar',qbar)
    elif symbol == 'mao_register4':
        assert set(c.inputs)=={'D0','D1','D2','D3','CLK'}
        assert set(c.outputs)=={'Q0','Q1','Q2','Q3'}
        for index in range(4):
            q,_=c.sequential('dff',
                {'d':c.inputs[f'D{index}'],'clk':c.inputs['CLK']})
            c.output(f'Q{index}',q)
    else:
        raise ValueError(f'未定义官方固定元件：{symbol}')
    return c.finish()


def official_packages(con, user_id):
    """Give one FIXED official component per completed lesson, never snapshot a user graph."""
    records=con.execute('''
        SELECT DISTINCT ca.level_id, ca.level_version, snaps.spec_json
        FROM circuit_level_attempts AS ca
        JOIN scores AS scores ON scores.id=ca.score_id
        JOIN circuit_level_snapshots AS snaps
          ON snaps.level_id=ca.level_id AND snaps.version=ca.level_version
        WHERE ca.user_id=? AND scores.user_id=? AND scores.completed=1
        ORDER BY ca.level_id, ca.level_version DESC
    ''',(user_id,user_id)).fetchall()
    fixed={}
    for row in records:
        spec=json.loads(row['spec_json'])
        symbol=spec['award']['symbol']
        if symbol not in FIXED_NAMES or symbol in fixed:
            continue
        definition=_build(symbol,spec['interface'])
        # Official definitions contain only built-in logic gates, never personal packages.
        engine.validate_graph(definition,allowed=None,interface=spec['interface'])
        typ=f'pkg:{symbol}@{FIXED_VERSION}'
        digest=hashlib.sha256(json.dumps(
            {'interface':spec['interface'],'graph':definition},
            sort_keys=True,ensure_ascii=False,separators=(',',':')
        ).encode('utf-8')).hexdigest()
        fixed[symbol]={'type':typ,'symbol':symbol,'version':FIXED_VERSION,
                       'name':FIXED_NAMES[symbol],
                       'levelId':row['level_id'],'levelVersion':row['level_version'],
                       'interface':spec['interface'],'graph':definition,'digest':digest}
    return {item['type']:item for item in fixed.values()}


# Install the official component policy into the existing circuit interfaces.
# The existing server and editor remain authoritative for saved graphs, judging,
# teacher-facing results, timer checks and route validation.
# No submitted student graph is ever promoted to a new component.
_DUPLICATE_BUILTIN = {
    'cmos_not':'not', 'cmos_nand':'nand',
    'army_not':'not', 'army_and':'and', 'army_or':'or',
    'army_nor':'nor', 'army_xor':'xor', 'army_xnor':'xnor',
}


def activate():
    """Called by chapters.py on startup; pure import-time wiring, no installer."""
    import sys
    import level_content as content

    if not getattr(content, '_official_components_active', False):
        historical_owned = content.owned
        historical_public_spec = content.public_spec

        def owned_with_official(con, user_id):
            _patch_service(sys.modules.get('circuit_service'))
            # Old immutable user-version definitions remain readable solely
            # for already-saved circuits that reference their historical ID.
            old = historical_owned(con, user_id)
            old.update(official_packages(con, user_id))
            return old

        def published_level_with_official_palette(level):
            _patch_service(sys.modules.get('circuit_service'))
            reply = historical_public_spec(level)
            builtins = set(reply.get('allowedTypes') or [])
            reply['allowedPackages'] = [
                symbol for symbol in (reply.get('allowedPackages') or [])
                if _DUPLICATE_BUILTIN.get(symbol) not in builtins
            ]
            return reply

        content.owned = owned_with_official
        content.public_spec = published_level_with_official_palette
        content._official_components_active = True

    # In the normal server.py boot path, chapters is imported first and all
    # service functions are ready by the time its import below returns.
    import circuit_service as service
    _patch_service(service)


def _patch_service(service):
    if service is None or getattr(service, '_official_components_active', False):
        return
    if not all(hasattr(service, n) for n in ('_unlocked','get_registry','get_component')):
        return  # Handles a circular import when service itself imports chapters.

    import database as db

    def no_student_created_package(con, user_id, spec, graph, defs):
        # Formal grades and teacher records are still saved by submit();
        # only the old INSERT into circuit_components is disabled.
        return None

    def official_registry(path, user_id):
        with closing(db.connect(path)) as con:
            fixed = official_packages(con, user_id)
        return {'types':engine.COMPONENTS,
                'circuitSchemaVersion':engine.SCHEMA_VERSION,
                'packages':[
                    {'type':type_id,'symbol':d['symbol'],'name':d['name'],
                     'version':d['version'],'interface':d['interface'],
                     'pins':engine.make_pins(d['interface']),
                     'isCurrent':True,'levelId':d['levelId']}
                    for type_id,d in sorted(fixed.items())
                ]}

    def no_package_inspection(path, user_id, symbol, version):
        raise engine.CircuitError('COMPONENT_PREVIEW_DISABLED',
                                  '官方器件不提供内部电路查看',404)

    service._unlocked = no_student_created_package
    service.get_registry = official_registry
    service.get_component = no_package_inspection
    service._official_components_active = True
