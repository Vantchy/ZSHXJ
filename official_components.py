"""固定教具目录：通关解锁官方元件，不把学生提交的电路实时封装成元件。

旧版个人封装由 level_content.owned 继续读取，仅用于兼容已经保存的电路图。
新版正式元件使用固定的 pkg:<symbol>@9000000 内部编号，以防与旧存档版本冲突。
玩家不会看到“封装”编号或任何内部预览。
"""
from __future__ import annotations

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
