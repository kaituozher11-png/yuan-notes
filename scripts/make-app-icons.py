"""Generate the two install icons from the existing four-point brand mark."""

from pathlib import Path

from PIL import Image, ImageDraw


def cubic(start, control1, control2, end, steps=24):
    points = []
    for index in range(1, steps + 1):
        t = index / steps
        u = 1 - t
        points.append(tuple(
            u**3 * start[axis] + 3 * u**2 * t * control1[axis]
            + 3 * u * t**2 * control2[axis] + t**3 * end[axis]
            for axis in (0, 1)
        ))
    return points


def make_icon(size, target):
    scale = 4
    canvas = 512 * scale
    image = Image.new("RGB", (canvas, canvas), "#f4f7f7")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((48 * scale, 48 * scale, 464 * scale, 464 * scale), radius=88 * scale, fill="#197980")

    anchors = [(256, 119), (393, 256), (256, 393), (119, 256)]
    controls = [((275, 215), (297, 237)), ((297, 275), (275, 297)),
                ((237, 297), (215, 275)), ((215, 237), (237, 215))]
    points = [anchors[0]]
    for index, (first, second) in enumerate(controls):
        points.extend(cubic(anchors[index], first, second, anchors[(index + 1) % 4]))
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in points], fill="#ffffff")
    image.resize((size, size), Image.Resampling.LANCZOS).save(target, optimize=True)


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "public" / "icons"
    output.mkdir(parents=True, exist_ok=True)
    for dimension in (192, 512):
        make_icon(dimension, output / f"icon-{dimension}.png")
    Image.open(output / "icon-512.png").save(
        output / "app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
