"""
python scripts/make-site-images.py

Builds the storefront imagery in public/images from the photos in scripts/image-sources:
model shots, fabric / plain-fabric / dupatta close-ups (plus one recoloured copy per colour
family, so a "Teal ... Fabric" shows teal), hero + lifestyle + collection banners.
File names must stay in sync with scripts/site-images.ts.
"""
from math import ceil
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "image-sources"
OUT = ROOT / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)
IVORY = (251, 247, 239)

pink = Image.open(SRC / "pink-silk.webp").convert("RGB")       # single model, pink Banarasi, dark green set
trio = Image.open(SRC / "trio.webp").convert("RGB")            # three models: magenta, purple, coral
group = Image.open(SRC / "heritage-group.webp").convert("RGB")  # four models: red, wine, blue paithani

PINK_SCALE = pink.width / 1333  # crop boxes for `pink` were measured on a 1333px-wide preview


def crop(im, box, scale=1.0):
    return im.crop(tuple(round(v * scale) for v in box))


def fit(im, w, h):
    out = im.resize((w, h), Image.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2)) if im.width < w else out


def cover(im, w, h, fx=0.5, fy=0.5):
    r = max(w / im.width, h / im.height)
    big = im.resize((ceil(im.width * r), ceil(im.height * r)), Image.LANCZOS)
    x, y = int((big.width - w) * fx), int((big.height - h) * fy)
    return big.crop((x, y, x + w, y + h))


def save(im, name):
    im.save(OUT / f"{name}.jpg", "JPEG", quality=82, optimize=True, progressive=True)


# ---------------------------------------------------------------- model shots (3:4)
SHOTS = {
    "saree-pink": crop(pink, (0, 20, 1333, 1797), PINK_SCALE),
    "saree-portrait": crop(pink, (380, 120, 1020, 973), PINK_SCALE),
    "saree-trio": crop(trio, (0, 110, 720, 1070)),
    "saree-magenta": crop(trio, (0, 390, 345, 850)),
    "saree-purple": crop(trio, (200, 220, 560, 700)),
    "saree-coral": crop(trio, (420, 330, 720, 730)),
    "saree-red": crop(group, (0, 180, 210, 460)),
    "saree-wine": crop(group, (80, 70, 245, 290)),
    "saree-blue": crop(group, (250, 90, 460, 370)),
    "saree-group": crop(group, (57, 0, 402, 460)),
}
for name, im in SHOTS.items():
    save(fit(im, 900, 1200), name)

# ---------------------------------------------------------------- close-ups + colour families (3:4)
SWATCHES = {
    "fabric-pallu": crop(pink, (720, 1150, 1140, 1710), PINK_SCALE),
    "fabric-pleats": crop(pink, (445, 1200, 705, 1547), PINK_SCALE),
    "fabric-jaal": crop(trio, (275, 640, 470, 900)),
    "fabric-paithani": crop(group, (320, 273, 460, 460)),
    "plain-coral": crop(trio, (460, 720, 680, 1013)),
    "plain-magenta": crop(trio, (90, 840, 285, 1100)),
    "dupatta-drape": crop(pink, (620, 380, 980, 860), PINK_SCALE),
    "dupatta-gold": crop(trio, (195, 320, 345, 520)),
}
# hue in degrees; ivory / black also change saturation + brightness
FAMILIES = {"red": 356, "gold": 42, "green": 145, "blue": 222, "teal": 182, "purple": 280, "pink": 335, "ivory": 38, "black": 0}


def dominant_hue(hsv):
    h, s, v = (hsv[..., i].astype(np.float32) for i in range(3))
    w = np.where((s > 60) & (v > 40), s * v, 0)
    ang = h / 256 * 2 * np.pi
    return float(np.arctan2((np.sin(ang) * w).sum(), (np.cos(ang) * w).sum()) % (2 * np.pi) / (2 * np.pi) * 256)


def recolor(im, family):
    hsv = np.array(im.convert("HSV")).astype(np.float32)
    src = dominant_hue(hsv)
    # only move pixels near the dominant hue, so gold zari and skin keep their colour
    dist = np.abs((hsv[..., 0] - src + 128) % 256 - 128)
    mask = np.clip(1 - (dist - 28) / 16, 0, 1) * np.clip((hsv[..., 1] - 25) / 30, 0, 1)
    target = FAMILIES[family] / 360 * 256
    hsv[..., 0] = (hsv[..., 0] + (target - src) * mask) % 256
    if family == "ivory":
        hsv[..., 1] *= 1 - 0.85 * mask
        hsv[..., 2] = hsv[..., 2] * (1 - 0.35 * mask) + 150 * 0.35 * mask
    elif family == "black":
        hsv[..., 1] *= 1 - 0.8 * mask
        hsv[..., 2] *= 1 - 0.7 * mask
    elif family == "red":
        hsv[..., 2] *= 1 - 0.25 * mask  # toward maroon
    return Image.fromarray(np.clip(hsv, 0, 255).astype(np.uint8), "HSV").convert("RGB")


for name, im in SWATCHES.items():
    base = fit(im, 720, 960)
    save(base, name)
    for family in FAMILIES:
        save(recolor(base, family), f"{name}-{family}")

# ---------------------------------------------------------------- banners


def feather(w, h, edge):
    a = np.full((h, w), 255, np.float32)
    ramp = np.linspace(0, 1, edge, dtype=np.float32)
    a[:, :edge] *= ramp
    a[:, w - edge:] *= ramp[::-1]
    return Image.fromarray(a.astype(np.uint8), "L")


def wide(src, w, h, x_center=0.72, bg=None):
    """Portrait photo on the right of a wide canvas; the left stays calm for headline text."""
    base = Image.new("RGB", (w, h), bg) if bg else ImageEnhance.Brightness(cover(src, w, h).filter(ImageFilter.GaussianBlur(40))).enhance(0.45)
    fg = src.resize((round(src.width * h / src.height), h), Image.LANCZOS)
    x = min(int(w * x_center - fg.width / 2), w - fg.width)
    base.paste(fg, (x, 0), feather(fg.width, h, min(160, fg.width // 4)))
    return base


def collage(w, h, parts, gutter=6):
    base = Image.new("RGB", (w, h), IVORY)
    pw = (w - gutter * (len(parts) - 1)) // len(parts)
    for i, (im, fy) in enumerate(parts):
        base.paste(cover(im, pw, h, fy=fy), (i * (pw + gutter), 0))
    return base


wall = tuple(int(c) for c in np.array(crop(pink, (220, 300, 420, 1000), PINK_SCALE)).reshape(-1, 3).mean(0))
save(wide(pink, 1920, 800, bg=wall), "hero-1")
save(cover(pink, 900, 1200, fy=0.1), "hero-1-m")
save(wide(group, 1920, 800), "hero-2")
save(cover(group, 900, 1200, fx=0.6), "hero-2-m")
save(wide(trio, 1920, 800), "hero-3")
save(cover(trio, 900, 1200, fy=0.15), "hero-3-m")

S, W = SHOTS, SWATCHES
save(collage(1400, 900, [(S["saree-pink"], 0.2), (S["saree-blue"], 0.2), (S["saree-purple"], 0.2)]), "life-1")
save(collage(1400, 900, [(S["saree-magenta"], 0.3), (W["fabric-pallu"], 0.5), (S["saree-coral"], 0.3)]), "life-2")
save(collage(1600, 600, [(S["saree-group"], 0.3), (W["fabric-pallu"], 0.5), (S["saree-purple"], 0.25), (S["saree-blue"], 0.3)]), "col-yanai")
save(collage(1600, 600, [(S["saree-portrait"], 0.3), (S["saree-red"], 0.3), (S["saree-trio"], 0.25), (W["fabric-paithani"], 0.5)]), "col-bridal")
save(collage(1600, 600, [(S["saree-purple"], 0.25), (W["fabric-jaal"], 0.5), (S["saree-magenta"], 0.3), (W["fabric-pleats"], 0.5)]), "col-banarasi")
save(collage(1600, 600, [(W["plain-coral"], 0.5), (S["saree-coral"], 0.3), (W["plain-magenta"], 0.5), (S["saree-magenta"], 0.3)]), "col-5000")
save(collage(1600, 600, [(S["saree-trio"], 0.25), (W["dupatta-drape"], 0.4), (S["saree-wine"], 0.3), (S["saree-portrait"], 0.3)]), "col-editors")

print(f"wrote {len(list(OUT.glob('*.jpg')))} images to {OUT}")
