from pathlib import Path
from docx import Document
from docx.enum.text import WD_BREAK
from pptx import Presentation
from pptx.util import Inches, Pt

out = Path(__file__).resolve().parent.parent / 'test-output'
out.mkdir(exist_ok=True)

doc = Document()
doc.add_heading('能量守恒定律', 0)
doc.add_paragraph('在封闭系统中，能量不会凭空产生或消失，只会发生转化。')
doc.add_paragraph('重点：区分能量转移与能量转化。')
doc.add_page_break()
doc.add_heading('动量守恒定律', 0)
doc.add_paragraph('当系统所受合外力为零时，总动量保持不变。')
doc.save(out / 'sample.docx')

slides = Presentation()
for title, body in [
    ('能量守恒定律', '能量不会凭空产生或消失。\n注意系统边界。'),
    ('动量守恒定律', '合外力为零时，总动量保持不变。'),
]:
    slide = slides.slides.add_slide(slides.slide_layouts[1])
    slide.shapes.title.text = title
    slide.placeholders[1].text = body
slides.save(out / 'sample.pptx')
