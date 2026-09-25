# Draws the app icon (a bus front on AT blue, with a live dot) at 1024 px and
# writes every size the app and installer need.
#
#   python tools/make_icon.py
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
S = 1024


def gradient(size, top, bottom):
    g = Image.new("RGBA", (1, size))
    for y in range(size):
        f = y / (size - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)) + (255,))
    return g.resize((size, size))


def icon(tray=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    pad = 20 if tray else 64
    ImageDraw.Draw(mask).rounded_rectangle((pad, pad, S - pad, S - pad), radius=230, fill=255)
    img.paste(gradient(S, (52, 120, 212), (20, 54, 112)), (0, 0), mask)
    d = ImageDraw.Draw(img)
    white, amber, lamp = (255, 255, 255, 255), (255, 176, 46, 255), (255, 232, 160, 255)
    # the bus front
    d.rounded_rectangle((262, 236, 762, 770), radius=80, fill=white)
    d.rounded_rectangle((304, 268, 720, 318), radius=14, fill=(20, 26, 36, 255))           # destination sign
    d.rounded_rectangle((330, 280, 560, 306), radius=8, fill=amber)
    d.rounded_rectangle((304, 344, 720, 566), radius=34, fill=(58, 128, 214, 255))          # windscreen
    d.rounded_rectangle((304, 344, 720, 566), radius=34, outline=(28, 70, 140, 255), width=10)
    d.polygon([(330, 540), (470, 370), (540, 370), (400, 540)], fill=(255, 255, 255, 60))   # glint
    d.ellipse((310, 616, 390, 696), fill=lamp)
    d.ellipse((634, 616, 714, 696), fill=lamp)
    d.rounded_rectangle((430, 640, 594, 672), radius=12, fill=(200, 212, 228, 255))         # grille
    d.rounded_rectangle((290, 756, 400, 846), radius=26, fill=white)                        # wheels
    d.rounded_rectangle((624, 756, 734, 846), radius=26, fill=white)
    # live
    d.ellipse((722, 118, 930, 326), fill=white)
    d.ellipse((748, 144, 904, 300), fill=(47, 168, 90, 255))
    return img


def main():
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "src", "assets"), exist_ok=True)
    big = icon()
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "build", "icon.png"))
    big.save(os.path.join(ROOT, "build", "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "src", "assets", "icon.png"))
    tray = icon(tray=True)
    tray.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, "src", "assets", "tray.png"))
    tray.resize((64, 64), Image.LANCZOS).save(os.path.join(ROOT, "src", "assets", "tray@2x.png"))
    print("icons written")


if __name__ == "__main__":
    main()
