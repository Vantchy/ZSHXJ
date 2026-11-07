"""Saved editor geometry must not affect the server's electrical truth or grading."""
import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import circuit_engine as engine
import circuit_service as service
import level_content

class LayoutCompatibilityTests(unittest.TestCase):
    def test_visual_paths_do_not_change_simulation_or_grade(self):
        raw=json.loads((ROOT/'tests/circuit_fixtures/half_adder.json').read_text())
        annotated=copy.deepcopy(raw)
        annotated['editorLayout']={
            'version':1,
            'paths':{'A:out|X:in1':[{'x':0,'y':0},{'x':140,'y':0},{'x':140,'y':160}]}
        }
        self.assertEqual(engine.validate_graph(annotated),engine.validate_graph(raw))
        for a in (0,1):
            for b in (0,1):
                expected=engine.simulate(raw,{'A':a,'B':b})['outputs']
                self.assertEqual(engine.simulate(annotated,{'A':a,'B':b})['outputs'],expected)
        spec=next(s for s in level_content.installed_specs() if s['id']=='ch1_half_adder')
        self.assertEqual(
            service._grade(spec,engine.validate_graph(raw),{})['passedCount'],
            service._grade(spec,engine.validate_graph(annotated),{})['passedCount'])
