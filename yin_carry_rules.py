"""CLA handwritten carry expansions, checked again on the server.
Identifiers: G0..G3, P0..P3, C0 only. Operations: conjunction (* or ·), disjunction (+), parentheses.
Each C2/3/4 must be expanded all the way to primary G/P/C0 variables.
"""
import re
TOKENS=re.compile(r"\s*(G[0-3]|P[0-3]|C0|[()+*·])")
MAX_FORMULA_LEN=240

class BadFormula(ValueError):
    pass

def tokenize(expr):
    if not isinstance(expr,str) or not 1<=len(expr)<=MAX_FORMULA_LEN:
        raise BadFormula('formula length')
    expr=expr.replace('×','*').replace('＋','+').replace('（','(').replace('）',')')
    result=[];cursor=0
    while cursor<len(expr):
        m=TOKENS.match(expr,cursor)
        if not m:raise BadFormula('unknown symbol')
        result.append(m.group(1));cursor=m.end()
    return result

class Parser:
    def __init__(self,tokens):self.t=tokens;self.i=0
    def take(self,token):
        if self.i<len(self.t) and self.t[self.i]==token:
            self.i+=1;return True
        return False
    def atom(self):
        if self.take('('):
            value=self.add()
            if not self.take(')'):raise BadFormula('missing right paren')
            return value
        if self.i>=len(self.t):raise BadFormula('empty atom')
        token=self.t[self.i]
        if re.fullmatch('(?:G|P)[0-3]|C0',token):
            self.i+=1;return ('var',token)
        raise BadFormula('invalid atom')
    def mul(self):
        left=self.atom()
        while self.take('*') or self.take('·'):
            left=('and',left,self.atom())
        return left
    def add(self):
        left=self.mul()
        while self.take('+'):
            left=('or',left,self.mul())
        return left

def parse(expr):
    parser=Parser(tokenize(expr));tree=parser.add()
    if parser.i!=len(parser.t):raise BadFormula('trailing expression')
    return tree

def evaluate(tree,values):
    if tree[0]=='var':return values[tree[1]]
    if tree[0]=='and':return evaluate(tree[1],values)&evaluate(tree[2],values)
    if tree[0]=='or':return evaluate(tree[1],values)|evaluate(tree[2],values)
    raise BadFormula('unknown operator')

def valid_expansion_answers(answers):
    if not isinstance(answers,dict) or set(answers)!={'C2','C3','C4'}:
        return False
    try:exprs={key:parse(formula) for key,formula in answers.items()}
    except BadFormula:return False
    # Verify for arbitrary G/P values, including values not realizable by input pairs.
    # That prevents accidentally accepting formulas that work only by don't-care coincidence.
    for mask in range(512):
        names=['G0','G1','G2','G3','P0','P1','P2','P3','C0']
        v={name:(mask>>i)&1 for i,name in enumerate(names)}
        c=v['C0'];carry={}
        for i in range(4):
            c=v[f'G{i}']|(v[f'P{i}']&c)
            carry[f'C{i+1}']=c
        if any(evaluate(exprs[key],v)!=carry[key] for key in exprs):
            return False
    return True
