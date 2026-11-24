"""Server-side answer checks for Mengjin narrative teaching boards.

The client never reports a trusted pass flag. A completed ordered step carries
its actual input; this module checks it against the *server's* deployed rules.
The existing per-student revisioned progress transaction remains authoritative.
"""
import json
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent / 'public' /
                    'scene-activities' / 'mengjin-teaching-boards.json').read_text(encoding='utf-8'))


def valid_board_answers(board_id, answers):
    if not isinstance(answers, dict):
        return False
    jade = RULES['jade']
    if board_id == jade['id']:
        villages = jade['villages']
        offerings = jade['offerings']
        if len(villages) * len(offerings) != 45 or len(set(villages)) != 9 or len(set(offerings)) != 5:
            return False
        if (type(answers.get('bits')) is not int or
                answers['bits'] != (45 - 1).bit_length()):
            return False
        code = jade['readCode']
        if len(code) != 6 or any(digit not in '01' for digit in code):
            return False
        index = int(code, 2)
        if not 0 <= index < len(villages) * len(offerings):
            return False
        if answers.get('decodedOffering') != offerings[index % len(offerings)]:
            return False
        desired = villages.index(jade['writeVillage']) * len(offerings) + offerings.index(jade['writeOffering'])
        if answers.get('encoded') != format(desired, '06b'):
            return False
        return set(answers) == {'bits', 'decodedOffering', 'encoded'}
    diviner = RULES['diviner']
    if board_id == diviner['id']:
        seen = answers.get('seen')
        return (set(answers) == {'seen'} and isinstance(seen, list) and
                len(seen) == len(diviner['patterns']) and
                all(isinstance(x, str) for x in seen) and
                set(seen) == set(diviner['patterns']))
    school = RULES.get('school', {})
    if board_id == school.get('truth', {}).get('id'):
        spec = school['truth']
        outputs = answers.get('outputs')
        inputs = spec['inputs']
        return (set(answers) == {'outputs'} and isinstance(outputs, list) and
                inputs == [format(i, '03b') for i in range(8)] and
                len(outputs) == len(inputs) and
                all(type(value) is int and value in (0, 1) and
                    value == int(bits.count('1') >= 2)
                    for bits, value in zip(inputs, outputs)))
    if board_id == school.get('fault', {}).get('id'):
        spec = school['fault']
        inputs, expected, observed = spec['inputs'], spec['expected'], spec['observed']
        unequal = [name for name, x, y in zip(inputs, expected, observed) if x != y]
        return (set(answers) == {'faultInput'} and
                inputs == ['00', '01', '10', '11'] and
                expected == [0, 1, 1, 0] and len(observed) == 4 and
                len(unequal) == 1 and answers.get('faultInput') == unequal[0])
    if board_id == school.get('delay', {}).get('id'):
        spec = school['delay']
        paths = spec['paths']
        per = spec['timePerPiece']
        if (set(answers) != {'criticalPath', 'totalDelay'} or
                paths != {'upper': 3, 'lower': 7} or type(per) is not int or per <= 0):
            return False
        critical = max(paths, key=paths.get)
        return (answers.get('criticalPath') == critical and
                type(answers.get('totalDelay')) is int and
                answers['totalDelay'] == paths[critical] * per)
    if board_id == school.get('regen', {}).get('id'):
        return (set(answers) == {'action', 'numericLimit'} and
                answers.get('action') == 'regenerate' and
                answers.get('numericLimit') == 'unknown')
    taosi = RULES.get('taosi', {})
    if board_id == taosi.get('representation', {}).get('id'):
        spec = taosi['representation']
        categories = answers.get('categories')
        relations = answers.get('relations')
        if set(answers) != {'categories','relations','counterexample'} or not isinstance(categories,dict) or not isinstance(relations,dict):
            return False
        expected_types = {item['key']:item['expectedType'] for item in spec['items']}
        expected_relations = {item['key']:item['expectedRelation'] for item in spec['items']}
        return (categories == expected_types and relations == expected_relations
                and answers['counterexample'] == spec['counterexample'])
    if board_id == taosi.get('direction', {}).get('id'):
        spec = taosi['direction']
        edges = answers.get('edges')
        return (set(answers) == {'edges','order','ringConclusion'} and
                isinstance(edges,list) and edges == spec['edges'] and
                answers.get('order') == spec['order'] and
                answers.get('ringConclusion') == spec['ringConclusion'])
    if board_id == taosi.get('oneway', {}).get('id'):
        spec = taosi['oneway']
        return (set(answers) == {'forward','reverse','maxStages','tradeoff'} and
                answers.get('forward') == spec['forward'] and
                answers.get('reverse') == spec['reverse'] and
                type(answers.get('maxStages')) is int and
                answers['maxStages'] == (spec['sourceStrength'] - spec['minimumReadable']) // spec['lossPerStage'] and
                answers.get('tradeoff') == spec['tradeoff'])

    if board_id == taosi.get('handoff', {}).get('id'):
        spec = taosi['handoff']
        return (set(answers) == {'source','obstacle','firstTask'} and
                answers.get('source') == spec['source'] and
                answers.get('obstacle') == spec['obstacle'] and
                answers.get('firstTask') == spec['firstTask'])
    yanwei = RULES.get('yanwei', {})
    if board_id == yanwei.get('backflow', {}).get('id'):
        spec=yanwei['backflow']
        blocked=answers.get('blocked')
        # Test both downstream disturbances with the *remaining* directed graph.
        if (set(answers) != {'blocked','diagnosis','perturbationPassed'} or
                not isinstance(blocked,list) or
                not all(isinstance(edge,str) for edge in blocked) or
                len(blocked)!=len(spec['reverseEdges']) or
                set(blocked)!=set(spec['reverseEdges']) or
                answers.get('diagnosis') != spec['diagnosis'] or
                answers.get('perturbationPassed') is not True):
            return False
        edges=spec['forwardEdges'] + [edge for edge in spec['reverseEdges'] if edge not in blocked]
        graph={}
        for edge in edges:
            start,end=edge.split('>');graph.setdefault(start,[]).append(end)
        for start in spec['disturbanceSources']:
            frontier=[start];seen=set()
            while frontier:
                at=frontier.pop()
                if at in seen:continue
                seen.add(at)
                if at in spec['protectedNodes']:return False
                frontier.extend(graph.get(at,[]))
        return True
    if board_id == yanwei.get('cascade', {}).get('id'):
        spec=yanwei['cascade']
        expected_ticks=list(range(1,len(spec['chain'])))
        return (set(answers)=={'start','stableTicks','fanoutLoads','fanoutConclusion'} and
                answers.get('start')=='A=1' and
                isinstance(answers.get('stableTicks'),list) and
                len(answers['stableTicks'])==len(expected_ticks) and
                all(type(value) is int for value in answers['stableTicks']) and
                answers['stableTicks']==[x*spec['timePerStage'] for x in expected_ticks] and
                type(answers.get('fanoutLoads')) is int and
                answers['fanoutLoads']==spec['fanoutLimit'] and
                answers.get('fanoutConclusion')=='within-limit')
    if board_id == yanwei.get('merge', {}).get('id'):
        spec=yanwei['merge']
        tried=answers.get('tried')
        return (set(answers)=={'tried','targetOutputs','missingStructure'} and
                isinstance(tried,list) and all(isinstance(item,str) for item in tried) and
                len(tried)==len(spec['candidates']) and
                set(tried)==set(spec['candidates']) and
                isinstance(answers.get('targetOutputs'),list) and
                len(answers['targetOutputs'])==len(spec['inputs']) and
                all(type(value) is int and value in (0,1) for value in answers['targetOutputs']) and
                answers['targetOutputs']==spec['targetOutputs'] and
                answers.get('missingStructure')==spec['missingStructure'])
    if board_id == RULES.get('yin',{}).get('expansion',{}).get('id'):
        from yin_carry_rules import valid_expansion_answers
        return valid_expansion_answers(answers)
    return False
