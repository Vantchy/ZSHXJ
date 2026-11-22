"""Auto-branching must change drawing topology without altering electrical logic."""
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import circuit_engine


def part(cid, kind, **fields):
    return {'id': cid, 'type': kind, 'x': 0, 'y': 0, **fields}


def wire(a, ap, b, bp):
    return {'from': {'comp': a, 'pin': ap}, 'to': {'comp': b, 'pin': bp}}


def test_same_terminal_auto_junction_matches_direct_wiring_truth_table():
    components=[part('A','input',name='A'),part('B','input',name='B'),
                part('Y','output',name='Y')]
    direct={'schemaVersion':1,'components':components,'wires':[
        wire('A','out','Y','in'),wire('B','out','Y','in')]}
    joined={'schemaVersion':1,'components':components+[part('J','junction')],
      'wires':[wire('A','out','J','a'),wire('J','out','Y','in'),wire('B','out','J','out')]}
    # Test not only compatible inputs, but mixed outputs that drive a conflict.
    for a,b in itertools.product((0,1),repeat=2):
        inputs={'A':a,'B':b}
        old=circuit_engine.simulate(direct,inputs)
        new=circuit_engine.simulate(joined,inputs)
        assert old['outputs']==new['outputs']
        assert old['unstable']==new['unstable']
        assert ('SHORT_CIRCUIT' in {w['code'] for w in old['warnings']})==(
            'SHORT_CIRCUIT' in {w['code'] for w in new['warnings']})
    assert len(circuit_engine.validate_graph(joined)['wires'])==3
