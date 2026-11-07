"""Engine-first tests grounded in the transistor→logic→memory course sequence."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import circuit_engine as ce
import circuit_service as service
import level_content as content

def fixture(name):
    return json.loads((ROOT/"tests"/"circuit_fixtures"/f"{name}.json").read_text())

def comp(cid,kind,**extras):
    return {"id":cid,"type":kind,"x":0,"y":0,**extras}

def edge(a,ap,b,bp):
    return {"from":{"comp":a,"pin":ap},"to":{"comp":b,"pin":bp}}

def graph(components,wires):
    return {"schemaVersion":1,"components":components,"wires":wires}

def package(symbol,g,inputs,outputs,name=None):
    return {f"pkg:{symbol}@1":{
        "name":name or symbol,"graph":g,
        "interface":{
            "inputs":[{"name":n,"width":1} for n in inputs],
            "outputs":[{"name":n,"width":1} for n in outputs],
        }
    }}

class CircuitEngineTest(unittest.TestCase):
    def test_transistor_cmos_not_both_inputs(self):
        g=fixture("cmos_not")
        self.assertEqual(ce.simulate(g,{"A":0})["outputs"],{"Y":1})
        self.assertEqual(ce.simulate(g,{"A":1})["outputs"],{"Y":0})
        for x in (0,1):
            self.assertFalse(ce.simulate(g,{"A":x})["unstable"])

    def test_transistor_four_device_nand_truth_table(self):
        g=fixture("cmos_nand")
        for a in (0,1):
            for b in (0,1):
                self.assertEqual(ce.simulate(g,{"A":a,"B":b})["outputs"]["Y"],
                                 1-int(bool(a and b)))

    def test_logic_half_adder_truth_table(self):
        g=fixture("half_adder")
        for a in (0,1):
            for b in (0,1):
                result=ce.simulate(g,{"A":a,"B":b})
                self.assertEqual(result["outputs"],{
                    "Sum":a^b,"Carry":int(bool(a and b))})
                self.assertFalse(result["unstable"])

    def test_sr_primitive_step_and_state(self):
        g=graph([comp("S","input",name="S"),comp("R","input",name="R"),
                 comp("M","sr_latch"),comp("Q","output",name="Q")],[
                 edge("S","out","M","s"),edge("R","out","M","r"),
                 edge("M","q","Q","in")])
        previous=None
        for (s,r),expect in [((1,0),1),((0,0),1),((0,1),0),((0,0),0)]:
            step=ce.simulate(g,{"S":s,"R":r},previous,cycles=1)
            self.assertEqual(step["outputs"]["Q"],expect)
            previous=step["state"]
        with self.assertRaisesRegex(ce.CircuitError,"不能同时"):
            ce.simulate(g,{"S":1,"R":1},previous,cycles=1)

    def test_gate_level_sr_latch_from_own_cmos_nands(self):
        pkgs=package("cmos_nand",fixture("cmos_nand"),["A","B"],["Y"])
        g=fixture("sr_latch")
        state=None
        for (s,r),cycles,expect in [
            ((0,1),1,(1,0)),((1,1),2,(1,0)),
            ((1,0),1,(0,1)),((1,1),2,(0,1))]:
            reply=ce.simulate(g,{"Sbar":s,"Rbar":r},state,cycles,pkgs)
            self.assertFalse(reply["unstable"],reply["warnings"])
            self.assertEqual((reply["outputs"]["Q"],reply["outputs"]["Qbar"]),expect)
            state=reply["state"]

    def test_nested_packages_and_immutable_pin_order(self):
        first=fixture("cmos_not")
        second=graph([
            comp("A","input",name="A"),comp("G","pkg:first@1"),
            comp("Y","output",name="Y")],
            [edge("A","out","G","A"),edge("G","Y","Y","in")])
        defs=package("first",first,["A"],["Y"])
        defs.update(package("second",second,["A"],["Y"]))
        outer=graph([comp("A","input",name="A"),comp("P","pkg:second@1"),
                     comp("Y","output",name="Y")],
                    [edge("A","out","P","A"),edge("P","Y","Y","in")])
        self.assertEqual(ce.simulate(outer,{"A":0},packages=defs)["outputs"]["Y"],1)
        self.assertEqual([p["name"] for p in ce.make_pins(defs["pkg:second@1"]["interface"])],
                         ["A","Y"])

    def test_floating_is_unknown_with_warning(self):
        g=graph([comp("A","input",name="A"),comp("G","not"),
                 comp("Y","output",name="Y")],
                [edge("G","out","Y","in")])
        result=ce.simulate(g,{"A":1})
        self.assertEqual(result["outputs"]["Y"],"X") # NOT(unwired input) is undefined
        self.assertTrue(result["unstable"])
        self.assertTrue(any(w["code"]=="FLOATING_PIN" and w["pin"]=="in"
                            for w in result["warnings"]))

    def test_output_instability_from_non_latch_feedback(self):
        g=graph([comp("G","not"),comp("Y","output",name="Y")],
                [edge("G","out","G","in"),edge("G","out","Y","in")])
        result=ce.simulate(g)
        self.assertTrue(result["unstable"])
        self.assertIn("UNSUPPORTED_FEEDBACK",[w["code"] for w in result["warnings"]])

    def test_rail_short_detection(self):
        g=graph([comp("P","vdd"),comp("N","gnd"),comp("J","junction"),
                 comp("Y","output",name="Y")],[
            edge("P","out","J","a"),edge("N","out","J","b"),
            edge("J","out","Y","in")])
        result=ce.simulate(g)
        self.assertTrue(result["unstable"])
        self.assertIn("SHORT_CIRCUIT",[w["code"] for w in result["warnings"]])

    def test_simulation_state_no_advance_without_clock(self):
        g=graph([comp("D","input",name="D"),comp("CLK","input",name="CLK"),
                 comp("FF","dff"),comp("Y","output",name="Y")],[
            edge("D","out","FF","d"),edge("CLK","out","FF","clk"),
            edge("FF","q","Y","in")])
        r=ce.simulate(g,{"D":1,"CLK":1},cycles=0)
        self.assertEqual(r["outputs"]["Y"],0)
        r=ce.simulate(g,{"D":1,"CLK":1},state=r["state"],cycles=1)
        self.assertEqual(r["outputs"]["Y"],1)

    def test_validation_unknown_type_pin_and_driver_limits(self):
        original=fixture("half_adder")
        cases=[
            ({"components":[{**original["components"][2],"type":"hacker"}]},
             "UNKNOWN_COMPONENT"),
        ]
        g=copy.deepcopy(original)
        g["components"][2]["type"]="hacker"
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(g)
        self.assertEqual(raised.exception.code,"UNKNOWN_COMPONENT")
        g=copy.deepcopy(original)
        g["wires"][0]["to"]["pin"]="oops"
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(g)
        self.assertEqual(raised.exception.code,"UNKNOWN_PIN")
        g=copy.deepcopy(original)
        g["wires"].append(edge("B","out","X","in1"))
        self.assertEqual(len(ce.validate_graph(g)["wires"]), len(g["wires"]))
        self.assertTrue(ce.simulate(g,{"A":0,"B":1})["unstable"])
        g=copy.deepcopy(original)
        g["wires"].append(edge("X","out","AND","out"))
        # Two outputs can be connected physically; ERC must report contention.
        self.assertIn("MULTIPLE_OUTPUT_DRIVERS",
                      [w["code"] for w in ce.simulate(g,{"A":1,"B":1})["warnings"]])
        g=copy.deepcopy(original)
        g["wires"].append(copy.deepcopy(g["wires"][0]))
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(g)
        self.assertEqual(raised.exception.code,"DUPLICATE_WIRE")

    def test_forbidden_type_schema_and_unowned_package(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_cmos_not")
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(fixture("half_adder"),allowed={
                "types":spec["allowedTypes"],"packages":spec["allowedPackages"]})
        self.assertEqual(raised.exception.code,"COMPONENT_FORBIDDEN")
        g=copy.deepcopy(fixture("cmos_not"))
        g["schemaVersion"]=99
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(g)
        self.assertEqual(raised.exception.code,"CIRCUIT_SCHEMA_MISMATCH")
        with self.assertRaises(ce.CircuitError) as raised:
            ce.validate_graph(fixture("sr_latch"),packages={})
        self.assertEqual(raised.exception.code,"PACKAGE_LOCKED")

    def test_grade_perfect_partial_and_unstable(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_cmos_not")
        correct=fixture("cmos_not")
        perfect=service._grade(spec,correct,{})
        self.assertEqual((perfect["passedCount"],perfect["totalCount"],perfect["completed"]),
                         (2,2,True))
        self.assertEqual((perfect["componentCount"],perfect["minimalComponentCount"]),(2,2))
        self.assertIsNone(perfect["firstFailure"])
        self.assertEqual(perfect["warnings"],[])
        self.assertNotIn("score",perfect)
        partial=graph([comp("A","input",name="A"),comp("N","gnd"),
                       comp("Y","output",name="Y")],
                      [edge("N","out","Y","in")])
        score=service._grade(spec,partial,{})
        self.assertEqual((score["passedCount"],score["totalCount"],score["completed"]),
                         (1,2,False))
        self.assertEqual(score["firstFailure"]["kind"],"truth")
        self.assertEqual(score["firstFailure"]["inputs"],{"A":0})
        self.assertEqual(score["firstFailure"]["expectedOutputs"],{"Y":1})
        self.assertEqual(score["firstFailure"]["actualOutputs"],{"Y":0})

    def test_simulation_budget_and_oversized_state_are_rejected(self):
        g=fixture("cmos_not")
        with self.assertRaises(ce.CircuitError) as trapped:
            ce.simulate(g,{"A":0},state={"packages":{"x":"z"*300000}})
        self.assertEqual(trapped.exception.code,"INVALID_SIMULATION_STATE")

    def test_published_content_cannot_change_in_place(self):
        import tempfile
        from unittest.mock import patch
        import database as db
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"immutable.sqlite3"
            db.init(path)
            content.publish(path)
            spec=next(x for x in content.installed_specs()
                      if x["id"]=="ch1_cmos_not")
            tampered=copy.deepcopy(spec)
            tampered["hiddenVectors"][0]["expect"]["Y"]=0
            other=[x for x in content.installed_specs()
                   if x["id"]!="ch1_cmos_not"]
            with patch("level_content.installed_specs",return_value=other+[tampered]):
                with self.assertRaisesRegex(RuntimeError,"不可原地修改"):
                    content.publish(path)
            with db.closing(db.connect(path)) as con:
                old=con.execute(
                    """SELECT spec_json FROM circuit_level_snapshots
                       WHERE level_id='ch1_cmos_not' AND version=1"""
                ).fetchone()
                self.assertEqual(json.loads(old["spec_json"]),spec)

    def test_multi_output_is_one_group_not_two_separate_points(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_half_adder")
        g=fixture("half_adder")
        # The sum output remains correct, but OR is incorrect for Carry when
        # only one of A/B is high. Each row fails as a WHOLE group.
        bad=copy.deepcopy(g)
        bad["components"][3]["type"]="or"
        graded=service._grade(spec,bad,{})
        self.assertEqual((graded["passedCount"],graded["totalCount"]),(2,4))
        self.assertEqual(graded["unit"],"组")
        first=graded["firstFailure"]
        self.assertEqual(first["groupNumber"],2)
        self.assertEqual(first["inputs"],{"A":0,"B":1})
        self.assertEqual(first["expectedOutputs"],{"Sum":1,"Carry":0})
        self.assertEqual(first["actualOutputs"],{"Sum":1,"Carry":1})
        self.assertFalse(first["unstable"])
        self.assertEqual(graded["minimalComponentCount"],2)

    def test_floating_warning_inside_package_is_visible_to_student(self):
        inner=graph([comp("A","input",name="A"),comp("INV","not"),
                     comp("Y","output",name="Y")],
                    [edge("INV","out","Y","in")])
        outer=graph([comp("A","input",name="A"),
                     comp("P","pkg:inverter@1"),
                     comp("Y","output",name="Y")],
                    [edge("A","out","P","A"),edge("P","Y","Y","in")])
        pkgs=package("inverter",inner,["A"],["Y"])
        result=ce.simulate(outer,{"A":1},packages=pkgs)
        floating=[w for w in result["warnings"] if w["code"]=="FLOATING_PIN"]
        self.assertEqual(len(floating),1)
        self.assertEqual(floating[0]["component"],"P/INV")
        self.assertEqual(floating[0]["pin"],"in")

    def test_warning_aggregates_unique_floating_input_pins(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_half_adder")
        g=fixture("half_adder")
        # Remove both B->gate connections; same 2 floating pins are observed
        # in 4 test groups but should only be counted once each.
        g["wires"]=[
            w for w in g["wires"]
            if w["from"]!={"comp":"B","pin":"out"}
        ]
        graded=service._grade(spec,g,{})
        floating=[w for w in graded["warnings"] if w["code"]=="FLOATING_PIN"]
        self.assertEqual(len(floating),1)
        self.assertEqual(floating[0]["count"],2)
        self.assertEqual(
            floating[0]["message"],"有 2 个输入引脚没有接线；悬空不会自动当作0")

    def test_unstable_cycle_never_passes_matching_output_by_chance(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_cmos_not")
        g=graph([
            comp("A","input",name="A"),comp("G","not"),
            comp("Y","output",name="Y")],
            [edge("G","out","G","in"),edge("G","out","Y","in")])
        result=service._grade(spec,g,{})
        self.assertFalse(result["completed"])
        self.assertEqual(result["passedCount"],0)
        self.assertTrue(result["firstFailure"]["unstable"])
        self.assertIn("UNSTABLE",[w["code"] for w in result["warnings"]])

    def test_short_and_unstable_are_reported_as_submission_reminders(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_cmos_not")
        g=graph([
            comp("A","input",name="A"),comp("H","vdd"),comp("L","gnd"),
            comp("J","junction"),comp("Y","output",name="Y")],
            [edge("H","out","J","a"),edge("L","out","J","b"),
             edge("J","out","Y","in")])
        graded=service._grade(spec,g,{})
        self.assertEqual(graded["passedCount"],0)
        self.assertTrue(graded["firstFailure"]["unstable"])
        texts={x["code"]:x["message"] for x in graded["warnings"]}
        self.assertEqual(texts["SHORT_CIRCUIT"],"电路存在高低电平短路")
        self.assertEqual(texts["UNSTABLE"],"电路输出无法稳定")

    def test_sequential_first_failed_step_location(self):
        spec=next(x for x in content.installed_specs()
                  if x["id"]=="ch1_sr_latch")
        g=fixture("sr_latch")
        # Swapping outputs makes the first latch set step wrong.
        for w in g["wires"]:
            if w["to"]=={"comp":"Q","pin":"in"}:
                w["from"]["comp"]="G2"
            elif w["to"]=={"comp":"QB","pin":"in"}:
                w["from"]["comp"]="G1"
        pkg=package("cmos_nand",fixture("cmos_nand"),["A","B"],["Y"])
        graded=service._grade(spec,g,pkg)
        first=graded["firstFailure"]
        self.assertEqual(first["kind"],"step")
        self.assertEqual(first["stepNumber"],1)
        self.assertEqual(first["scriptName"],"置位保持复位保持")
        self.assertEqual(first["inputs"],{"Sbar":0,"Rbar":1})
        self.assertEqual(first["expectedOutputs"],{"Q":1,"Qbar":0})
        self.assertEqual(first["actualOutputs"],{"Q":0,"Qbar":1})
        self.assertEqual(graded["unit"],"步")

    def test_package_cycle_direct_indirect_and_unknown(self):
        graph_a=graph([comp("A","input",name="A"),
                       comp("X","pkg:second@1"),
                       comp("Y","output",name="Y")],
                      [edge("A","out","X","A"),edge("X","Y","Y","in")])
        graph_b=graph([comp("A","input",name="A"),
                       comp("X","pkg:first@1"),
                       comp("Y","output",name="Y")],
                      [edge("A","out","X","A"),edge("X","Y","Y","in")])
        defs=package("first",graph_a,["A"],["Y"])
        defs.update(package("second",graph_b,["A"],["Y"]))
        with self.assertRaises(ce.CircuitError) as raised:
            content.validate_package_dag(defs)
        self.assertEqual(raised.exception.code,"PACKAGE_CYCLE")
        with self.assertRaises(ce.CircuitError) as raised:
            content.validate_package_dag(
                package("first",fixture("cmos_not"),["A"],["Y"]),
                prospective_symbol="first",new_graph=graph_b)
        self.assertEqual(raised.exception.code,"PACKAGE_CYCLE")

if __name__=="__main__":
    unittest.main()
