"""CLA handwritten carry expansions, checked again on the server.
Identifiers accept both ASCII and common subscript forms:
  G0..G3 / G₀..G₃, P0..P3 / P₀..P₃, C0..C4 / C₀..C₄.
Operations: conjunction (* or ·), disjunction (+), parentheses.
For usability we also accept progressive carry references (for example C2 = G1 + P1*C1),
but a target carry may only reference *earlier* carries, never itself or later carries.
"""
import re

MAX_FORMULA_LEN = 240

# Only this optional story jade board permits an explicit, auditable skip.
# No formal circuit-grade evidence is affected.
SKIP_EVIDENCE = {'completionMode': 'skipped', 'reason': 'user-requested'}
_SUBSCRIPTS = str.maketrans({'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4'})

# Accept upper/lowercase tokens after normalization.
TOKENS = re.compile(r"\s*([GPC][0-4]|[()+*·])", re.IGNORECASE)

class BadFormula(ValueError):
    pass

def normalize(expr):
    if not isinstance(expr, str) or not 1 <= len(expr) <= MAX_FORMULA_LEN:
        raise BadFormula('formula length')
    expr = (expr.replace('×', '*')
                .replace('✕', '*')
                .replace('＋', '+')
                .replace('（', '(')
                .replace('）', ')')
                .replace('•', '·')
                .replace('⋅', '·')
                .translate(_SUBSCRIPTS)
                .upper())
    return expr

def tokenize(expr):
    expr = normalize(expr)
    result = []
    cursor = 0
    while cursor < len(expr):
        m = TOKENS.match(expr, cursor)
        if not m:
            raise BadFormula('unknown symbol')
        token = m.group(1).upper()
        result.append(token)
        cursor = m.end()
    return result

class Parser:
    def __init__(self, tokens):
        self.t = tokens
        self.i = 0
    def take(self, token):
        if self.i < len(self.t) and self.t[self.i] == token:
            self.i += 1
            return True
        return False
    def atom(self):
        if self.take('('):
            value = self.add()
            if not self.take(')'):
                raise BadFormula('missing right paren')
            return value
        if self.i >= len(self.t):
            raise BadFormula('empty atom')
        token = self.t[self.i]
        if re.fullmatch(r'(?:G|P)[0-3]|C[0-4]', token):
            self.i += 1
            return ('var', token)
        raise BadFormula('invalid atom')
    def mul(self):
        left = self.atom()
        while self.take('*') or self.take('·'):
            left = ('and', left, self.atom())
        return left
    def add(self):
        left = self.mul()
        while self.take('+'):
            left = ('or', left, self.mul())
        return left

def parse(expr):
    parser = Parser(tokenize(expr))
    tree = parser.add()
    if parser.i != len(parser.t):
        raise BadFormula('trailing expression')
    return tree

def collect_vars(tree):
    if tree[0] == 'var':
        return {tree[1]}
    if tree[0] in ('and', 'or'):
        return collect_vars(tree[1]) | collect_vars(tree[2])
    raise BadFormula('unknown operator')

def derived_carries(values):
    c = values['C0']
    carry = {'C0': c}
    for i in range(4):
        c = values[f'G{i}'] | (values[f'P{i}'] & c)
        carry[f'C{i+1}'] = c
    return carry

def evaluate(tree, values, carry):
    if tree[0] == 'var':
        name = tree[1]
        if name in values:
            return values[name]
        if name in carry:
            return carry[name]
        raise BadFormula('unknown variable')
    if tree[0] == 'and':
        return evaluate(tree[1], values, carry) & evaluate(tree[2], values, carry)
    if tree[0] == 'or':
        return evaluate(tree[1], values, carry) | evaluate(tree[2], values, carry)
    raise BadFormula('unknown operator')

def _allowed_formula_vars(target):
    order = {'C2': {'C0', 'C1'}, 'C3': {'C0', 'C1', 'C2'}, 'C4': {'C0', 'C1', 'C2', 'C3'}}
    return {*(f'G{i}' for i in range(4)), *(f'P{i}' for i in range(4))} | order[target]

def valid_expansion_answers(answers):
    if answers == SKIP_EVIDENCE:
        return True
    if not isinstance(answers, dict) or set(answers) != {'C2', 'C3', 'C4'}:
        return False
    try:
        exprs = {key: parse(formula) for key, formula in answers.items()}
        for target, tree in exprs.items():
            if not collect_vars(tree) <= _allowed_formula_vars(target):
                return False
    except BadFormula:
        return False
    # Verify against all primary G/P/C0 assignments.
    names = ['G0', 'G1', 'G2', 'G3', 'P0', 'P1', 'P2', 'P3', 'C0']
    for mask in range(512):
        values = {name: (mask >> i) & 1 for i, name in enumerate(names)}
        carry = derived_carries(values)
        for key, tree in exprs.items():
            if evaluate(tree, values, carry) != carry[key]:
                return False
    return True
