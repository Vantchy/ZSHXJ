"""阳城六事: invariants for new formal quests and NAND-only specs, no live DB."""
from pathlib import Path
from itertools import product
import ast, json, unittest, hashlib

ROOT=Path(__file__).resolve().parents[1]
STORY=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
NAMES=['not','and','or','nor','xor','xnor']
PLACES=['yangcheng-valley-deception','yangcheng-camp-assault',
    'yangcheng-camp-supply','yangcheng-valley-bivouac',
    'yangcheng-watch-night','yangcheng-camp-seal']
EXPECTED={
  'not':lambda a,b:1-a,'and':lambda a,b:a&b,
  'or':lambda a,b:a|b,'nor':lambda a,b:1-(a|b),
  'xor':lambda a,b:a^b,'xnor':lambda a,b:1-(a^b),
}

def get_authoring_scope():
    tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
    target=[]
    for node in tree.body:
        if isinstance(node,ast.FunctionDef) and node.name=='yangcheng_army_quest':
            target.append(node)
    assert len(target)==1
    scope={}
    exec(compile(ast.Module(body=target,type_ignores=[]),'chapters.py','exec'),scope)
    return scope

class YangchengStoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scope=get_authoring_scope()
        cls.quests=[scope['yangcheng_army_quest'](i) for i in range(6)]
        cls.levels=[json.loads((ROOT/f'levels/ch1_army_{key}_v1.json').read_text('utf-8')) for key in NAMES]

    def test_six_ordered_quests_and_links(self):
        self.assertEqual([q['id'] for q in self.quests],['yangcheng-army-'+x for x in NAMES])
        previous='taosi-nand-first'
        for key,place,quest in zip(NAMES,PLACES,self.quests):
            self.assertEqual(quest['prerequisites'],[previous]);previous=quest['id']
            self.assertEqual(quest['locationId'],place)
            self.assertEqual(quest['completion'],{
                'mode':'official-circuit','levelIds':[f'ch1_army_{key}'],'requireAllSteps':True})
            steps=quest['steps']
            self.assertEqual([x['condition']['type'] for x in steps],
                ['dialogue-finished','level-completed','dialogue-finished'])
            self.assertEqual(steps[1]['condition']['levelId'],f'ch1_army_{key}')
            target=STORY['questTargets'][quest['id']]
            self.assertEqual(set(target['steps']),{x['id'] for x in steps})
            self.assertEqual(target['scene']['supportingDialogues'],
                             {steps[1]['id']:f'army-{key}-practice'})
            self.assertTrue(target['scene']['allowReplay'])
            self.assertEqual(target['scene']['actions'][steps[2]['id']][0]['action'],
                             'complete-and-submit')
            self.assertEqual(target['scene']['actions'][steps[0]['id']][0]['action'],
                             'complete-and-level')

    def test_story_dialogues_and_all_location_overlays_grounded(self):
        locs=[loc['id'] for loc in STORY['locations']]
        dialogue_ids=[d['id'] for d in STORY['dialogues']]
        self.assertEqual(len(locs),len(set(locs)))
        self.assertEqual(len(dialogue_ids),len(set(dialogue_ids)))
        self.assertTrue(set(PLACES).issubset(set(locs)))
        for key in NAMES:
            for suffix in ('intro','practice','report'):
                self.assertIn(f'army-{key}-{suffix}',dialogue_ids)
        self.assertIn('少康',str(next(d for d in STORY['dialogues'] if d['id']=='army-xnor-report')))

    def test_nand_only_real_specs_with_hidden_truth_tables(self):
        for key,spec in zip(NAMES,self.levels):
            self.assertEqual(spec['id'],f'ch1_army_{key}')
            self.assertEqual(spec['layer'],'gate')
            self.assertEqual(spec['allowedTypes'],['input','output','nand'])
            self.assertEqual(spec['allowedPackages'],['cmos_nand'])
            self.assertEqual(spec['version'],1)
            self.assertEqual(spec['schemaVersion'],1)
            self.assertEqual(spec['award']['symbol'],f'army_{key}')
            expected_input=['A'] if key=='not' else ['A','B']
            self.assertEqual([pin['name'] for pin in spec['interface']['inputs']],expected_input)
            vectors=spec['hiddenVectors']
            self.assertEqual(len(vectors),2 if key=='not' else 4)
            self.assertEqual({tuple(v['inputs'][name] for name in expected_input) for v in vectors},
                             set(product((0,1),repeat=len(expected_input))))
            for v in vectors:
                a=v['inputs']['A'];b=v['inputs'].get('B',0)
                self.assertEqual(v['expect']['Y'],EXPECTED[key](a,b))
            self.assertEqual(spec['initialGraph']['wires'],[])
            self.assertTrue(all(component['type'] in spec['allowedTypes']
                                for component in spec['initialGraph']['components']))
            self.assertTrue(spec['publicVectors'])
            self.assertTrue(spec['efficientAtMost']>=1)

    def test_background_files_are_original_uploads(self):
        for file in ('yangcheng-valley-day.png','yangcheng-camp-day.png','yangcheng-watch-night.png'):
            p=ROOT/'public/assets/scenes'/file
            self.assertTrue(p.is_file())
            self.assertGreater(p.stat().st_size,3000000)

if __name__=='__main__':unittest.main()

# Reference NAND-only constructions. This checks circuit solvability independently
# of the game editor; server simulation/DB verification remains an integration test.
def _nand(a,b): return 1-(a & b)
def _nand_compose(name,a,b):
    if name=='not': return _nand(a,a)
    if name=='and':
        n=_nand(a,b);return _nand(n,n)
    if name=='or':return _nand(_nand(a,a),_nand(b,b))
    if name=='nor':
        n=_nand(_nand(a,a),_nand(b,b));return _nand(n,n)
    if name in ('xor','xnor'):
        p=_nand(a,b);q=_nand(a,p);r=_nand(b,p);x=_nand(q,r)
        return _nand(x,x) if name=='xnor' else x
    raise ValueError(name)


def test_reference_nand_constructions():
    for name in NAMES:
        for a,b in product((0,1),repeat=2):
            assert _nand_compose(name,a,b)==EXPECTED[name](a,b), (name,a,b)
