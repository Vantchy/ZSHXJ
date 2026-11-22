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
    return False
