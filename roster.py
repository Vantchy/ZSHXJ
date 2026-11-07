"""学生名单解析（CSV、TSV、XLSX），仅使用标准库；不执行 Excel 公式。"""
import csv
import io
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ROWS = 300
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
SNO_NAMES = {"学号", "studentno", "student_no", "id", "studentid"}
NAME_NAMES = {"姓名", "名字", "name", "displayname", "display_name", "学生姓名"}


def decode_csv(data):
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return data.decode("gb18030")
        except UnicodeDecodeError:
            raise ValueError("CSV编码无法识别，请转换为UTF-8或GB18030")


def parse_csv(data, suffix):
    text = decode_csv(data)
    reader = csv.reader(io.StringIO(text, newline=""),
                        delimiter="\t" if suffix == ".tsv" else ",",
                        strict=True)
    try:
        return [(i, row) for i, row in enumerate(reader, 1) if any(x.strip() for x in row)]
    except csv.Error as error:
        raise ValueError("CSV格式错误：" + str(error))


def col_num(ref):
    match = re.match(r"([A-Za-z]+)", ref)
    if not match:
        return None
    value = 0
    for letter in match.group(1).upper():
        value = value * 26 + ord(letter) - ord("A") + 1
    return value - 1


def normalize_excel_integer(raw):
    """Restore an exact ten-digit integer from Excel numeric/scientific XML.

    Decimal avoids float rounding. Never fabricate missing leading zeros or
    guess numbers that Excel has already rounded/truncated.
    """
    value = raw.strip()
    if len(value) > 64 or not re.fullmatch(
        r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?",
        value,
    ):
        return raw
    try:
        decimal = Decimal(value)
        if (decimal == decimal.to_integral_value()
                and Decimal("1000000000") <= decimal <= Decimal("9999999999")):
            return str(int(decimal))
    except (InvalidOperation, ValueError, OverflowError):
        pass
    return raw


def parse_xlsx(data):
    try:
        book = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Excel文件损坏或不是.xlsx格式")
    with book:
        info = book.infolist()
        if len(info) > 300 or sum(x.file_size for x in info) > 8 * 1024 * 1024:
            raise ValueError("Excel文件结构过大；请拆分名单")
        for part in info:
            if part.file_size > 5 * 1024 * 1024:
                raise ValueError("Excel内部工作表过大")
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            for item in root.findall(NS + "si"):
                strings.append("".join(node.text or "" for node in item.iter(NS + "t")))

        # 根据 workbook.xml.rels 找到第一个工作表，而不是假设 sheet1.xml。
        try:
            workbook = ET.fromstring(book.read("xl/workbook.xml"))
            first = workbook.find(NS + "sheets/" + NS + "sheet")
            if first is None:
                raise ValueError("Excel中没有工作表")
            relation_id = first.attrib.get(REL_NS + "id")
            relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
            target = next((
                x.attrib.get("Target") for x in relations.findall(PACKAGE_REL_NS + "Relationship")
                if x.attrib.get("Id") == relation_id
            ), None)
            if not target:
                raise ValueError("无法定位Excel的第一个工作表")
            if target.startswith("/"):
                sheet_path = target.lstrip("/")
            else:
                sheet_path = posixpath.normpath(posixpath.join("xl", target))
            if not sheet_path.startswith("xl/worksheets/"):
                raise ValueError("Excel工作表路径不合法")
            sheet = ET.fromstring(book.read(sheet_path))
        except (KeyError, ET.ParseError) as error:
            raise ValueError("Excel工作簿结构无法解析") from error

        records = []
        for row in sheet.findall(".//" + NS + "sheetData/" + NS + "row"):
            number = int(row.attrib.get("r", len(records) + 1))
            cells = {}
            for cell in row.findall(NS + "c"):
                index = col_num(cell.attrib.get("r", ""))
                if index is None or index > 20:
                    continue
                if cell.find(NS + "f") is not None:
                    value = "#FORMULA_NOT_SUPPORTED"
                elif cell.attrib.get("t") == "inlineStr":
                    value = "".join(x.text or "" for x in cell.findall(".//" + NS + "t"))
                else:
                    v = cell.find(NS + "v")
                    raw = (v.text or "") if v is not None else ""
                    if cell.attrib.get("t") == "s":
                        try:
                            value = strings[int(raw)]
                        except (IndexError, ValueError):
                            value = ""
                    elif cell.attrib.get("t") in (None, "n"):
                        value = normalize_excel_integer(raw)
                    else:
                        value = raw
                cells[index] = value
            if cells and any(str(x).strip() for x in cells.values()):
                last = max(cells)
                records.append((number, [cells.get(i, "") for i in range(last + 1)]))
            if len(records) > MAX_ROWS + 2:
                raise ValueError("每批最多300人，请拆分名单")
        return records


def normalize_header(value):
    return re.sub(r"[\s-]+", "", str(value)).lower()


def parse_roster(filename, content):
    if not isinstance(filename, str):
        raise ValueError("必须提供文件名")
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in (".csv", ".tsv", ".xlsx"):
        raise ValueError("仅支持.csv、.tsv、.xlsx文件（不支持旧.xls）")
    if not isinstance(content, bytes) or not 1 <= len(content) <= MAX_FILE_BYTES:
        raise ValueError("文件大小必须在1字节至2MB之间")
    try:
        records = parse_xlsx(content) if suffix == ".xlsx" else parse_csv(content, suffix)
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        raise ValueError("文件内部结构损坏，无法解析") from error
    if not records:
        raise ValueError("名单文件为空")
    header_line, header = records[0]
    headings = [normalize_header(x) for x in header]
    sno = next((i for i, key in enumerate(headings) if key in SNO_NAMES), None)
    name = next((i for i, key in enumerate(headings) if key in NAME_NAMES), None)
    if sno is None or name is None or sno == name:
        raise ValueError("名单表头必须包含“学号”和“姓名”两列")
    result = []
    for line, cells in records[1:]:
        result.append({
            "row": line,
            "studentNo": str(cells[sno]).strip() if len(cells) > sno else "",
            "name": str(cells[name]).strip() if len(cells) > name else "",
        })
    return result


def csv_safe(value, force_text=False):
    """处理导出到电子表格中的不可信文本，OWASP 所述公式前缀必须安全化。"""
    value = "" if value is None else str(value)
    stripped = value.lstrip(" \t\r\n\u200b\ufeff")
    dangerous = "=+-@\t\r\n＝＋－＠"
    # Excel打开时的类型推断还会吞掉有前导0的纯数字学号。
    leading_zero_id = force_text and value.startswith("0") and value.isdigit()
    if stripped[:1] in dangerous or leading_zero_id:
        return "\t" + value
    return value


def make_csv(headers, records, text_cols=None):
    out = io.StringIO(newline="")
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(headers)
    # 不仅是姓名和班级，成绩详情也来自前端；每一列都必须做公式前缀检查。
    # text_cols为调用方保留的可选参数，所有字段仍执行CSV安全转义。
    for row in records:
        writer.writerow([
            csv_safe(value, force_text=(i == 1))
            for i, value in enumerate(row)
        ])
    return ("\ufeff" + out.getvalue()).encode("utf-8")
