"""Browser regression checks. Run: python -m unittest discover -s tests -v

Development dependencies: pip install playwright Pillow
Browser setup: python -m playwright install chromium
The app itself needs none of these dependencies.
"""
import io
import json
from pathlib import Path
import unittest

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]


def photo(name="photo.png", color="#db765b"):
    image = Image.new("RGB", (800, 600), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((400, 0, 799, 599), fill="#4d819b")
    stream = io.BytesIO()
    image.save(stream, "PNG")
    return {"name": name, "mimeType": "image/png", "buffer": stream.getvalue()}


class BrowserChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1050}, accept_downloads=True)
        self.page = self.context.new_page()
        self.errors = []
        self.network = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("request", lambda request: self.network.append(request.url) if request.url.startswith(("https:", "http:")) else None)
        self.page.on("dialog", lambda dialog: dialog.accept())
        self.page.goto((ROOT / "index.html").as_uri())
        expect(self.page.locator(".grid-cell")).to_have_count(9)
        expect(self.page.locator("html")).to_have_attribute("lang", "ja")
        self.page.locator('[data-language="zh"]').click()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "Browser runtime errors")
        self.assertEqual(self.network, [], "App should make no external requests")

    def change(self, selector, value):
        field = self.page.locator(selector)
        field.fill(str(value))
        field.dispatch_event("change")

    def save_project(self):
        with self.page.expect_download() as event:
            self.page.locator("#save-project").click()
        return json.loads(Path(event.value.path()).read_text(encoding="utf-8"))

    def export(self):
        with self.page.expect_download(timeout=60000) as event:
            self.page.locator("#export").click()
        image = Image.open(event.value.path())
        image.load()
        return image.convert("RGBA")

    def test_crop_export_and_transparency(self):
        expect(self.page.locator("#export")).to_be_disabled()
        self.change("#columns", 1)
        self.change("#rows", 1)
        self.page.locator("#photo-input").set_input_files(photo())
        expect(self.page.locator("#crop-dialog")).to_be_visible()
        self.page.locator("#crop-zoom").fill("2")
        self.page.locator("#crop-zoom").dispatch_event("input")
        canvas = self.page.locator("#crop-canvas")
        box = canvas.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()
        self.page.mouse.move(box["x"] + box["width"] * .7, box["y"] + box["height"] / 2, steps=5)
        self.page.mouse.up()
        self.page.locator("#confirm-crop").click()
        expect(self.page.locator("#crop-dialog")).not_to_be_visible()
        self.page.locator(".text-entry input").nth(0).fill("我的人偶")
        data = self.save_project()
        self.assertEqual(data["dolls"][0]["crop"]["zoom"], 2)
        self.assertLess(data["dolls"][0]["crop"]["x"], 400)
        self.assertEqual(data["dolls"][0]["texts"][0], "我的人偶")
        image = self.export()
        self.assertEqual(image.size, (4096, 4096))
        self.assertEqual(image.getpixel((0, 0)), (255, 253, 248, 255))
        self.assertNotEqual(image.getpixel((2048, 1600)), (255, 253, 248, 255))
        # Capture and compare actual rendered transparency, rather than only settings.
        self.page.locator("#transparent").check()
        circle = self.export()
        self.assertEqual(circle.getpixel((0, 0))[3], 0)
        self.assertGreater(circle.getpixel((2048, 1600))[3], 0)
        self.page.get_by_role("button", name="裁剪第 1 张照片").click()
        self.page.locator('input[name="shape"][value="square"]').check()
        self.page.locator("#confirm-crop").click()
        square = self.export()
        self.assertGreater(square.getchannel("A").histogram()[255], circle.getchannel("A").histogram()[255])

    def test_capacity_swap_settings_and_round_trip(self):
        self.change("#columns", 2)
        self.change("#rows", 1)
        self.page.locator("#photo-input").set_input_files([photo("first.png"), photo("second.png", "#a5bd8c"), photo("overflow.png")])
        expect(self.page.locator(".doll-card")).to_have_count(2)
        expect(self.page.locator("#add")).to_be_disabled()
        self.page.locator(".doll-card").nth(0).locator("input").nth(0).fill("第一位")
        self.page.locator(".doll-card").nth(1).locator("input").nth(0).fill("第二位")
        self.page.locator(".grid-cell").nth(0).drag_to(self.page.locator(".grid-cell").nth(1))
        expect(self.page.locator(".doll-card").nth(0).locator("input").nth(0)).to_have_value("第二位")
        self.page.locator(".grid-cell").nth(0).click()
        self.page.locator(".grid-cell").nth(1).click()
        expect(self.page.locator(".doll-card").nth(0).locator("input").nth(0)).to_have_value("第一位")
        self.change("#columns", 1)
        expect(self.page.locator("#columns")).to_have_value("2")
        self.change("#line-count", 4)
        self.page.locator(".doll-card").nth(0).locator("input").nth(3).fill("第四行保留")
        self.change("#line-count", 2)
        self.change("#line-count", 4)
        expect(self.page.locator(".doll-card").nth(0).locator("input").nth(3)).to_have_value("第四行保留")
        self.page.locator(".line-style select").nth(1).select_option("kai")
        self.change('.line-style:nth-child(2) input[type="number"]', 55)
        self.page.locator("#image-scale").fill("70")
        self.page.locator("#image-scale").dispatch_event("input")
        self.page.locator("#text-scale").fill("120")
        self.page.locator("#text-scale").dispatch_event("input")
        self.change("#width", 2048)
        original = self.save_project()
        self.assertEqual(original["settings"]["styles"][1], {"font": "kai", "size": 55, "background":"#ffffff", "transparent":True})
        self.assertEqual(original["settings"]["imageScale"], 70)
        self.assertEqual(original["settings"]["textScale"], 120)
        self.page.get_by_role("button", name="删除第 1 位人偶").click()
        expect(self.page.locator("#add")).to_be_enabled()
        self.page.locator("#project-input").set_input_files({"name":"project.json", "mimeType":"application/json", "buffer":json.dumps(original).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator(".doll-card")).to_have_count(2)
        restored = self.save_project()
        self.assertEqual(original, restored)
        self.assertEqual(self.export().size, (2048, 4096))
        # Rejected project files must leave the current project intact.
        bad = json.loads(json.dumps(original))
        bad["dolls"][0]["src"] = "https://example.com/not-allowed.png"
        self.page.locator("#project-input").set_input_files({"name":"bad.json", "mimeType":"application/json", "buffer":json.dumps(bad).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#status")).to_contain_text("无效的照片")
        self.assertEqual(original, self.save_project())

    def test_rectangular_guides_mobile_and_cancel_crop(self):
        self.change("#width", 2048)
        self.change("#height", 4096)
        self.page.locator("#photo-input").set_input_files(photo())
        expect(self.page.locator("#crop-dialog")).to_be_visible()
        self.page.locator("#crop-zoom").fill("3")
        self.page.locator("#crop-zoom").dispatch_event("input")
        self.page.get_by_role("button", name="取消", exact=True).click()
        self.assertEqual(self.save_project()["dolls"][0]["crop"]["zoom"], 1)
        self.page.wait_for_function("document.querySelector('#preview').height === 1400")
        board = self.page.locator("#board").bounding_box()
        cell = self.page.locator(".grid-cell").first.bounding_box()
        self.assertAlmostEqual((cell["x"] - board["x"]) / board["width"], .035, delta=.003)
        self.assertAlmostEqual((cell["y"] - board["y"]) / board["height"], .035, delta=.003)
        self.change("#width", 8192)
        self.change("#height", 8192)
        expect(self.page.locator("#height")).to_have_value("4096")
        self.page.set_viewport_size({"width":390,"height":844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.get_by_role("button", name="裁剪第 1 张照片").click()
        self.assertTrue(self.page.evaluate("document.querySelector('dialog').getBoundingClientRect().width <= innerWidth"))
        self.page.locator("#crop-canvas").focus()
        self.page.keyboard.press("ArrowLeft")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#crop-dialog")).not_to_be_visible()

    def test_rectangle_layers_title_and_project_round_trip(self):
        self.change("#columns", 1)
        self.change("#rows", 1)
        self.change("#width", 1024)
        self.change("#height", 1024)
        self.page.locator("#photo-input").set_input_files(photo())
        self.page.locator('input[name="shape"][value="rectangle"]').check()
        expect(self.page.locator("#rectangle-settings")).to_be_visible()
        canvas = self.page.locator("#crop-canvas")
        box = canvas.bounding_box()
        # Grab the bottom-right corner and resize width and height independently.
        self.page.mouse.move(box["x"] + box["width"] * .9, box["y"] + box["height"] * .9)
        self.page.mouse.down()
        self.page.mouse.move(box["x"] + box["width"] * .8, box["y"] + box["height"] * .5, steps=8)
        self.page.mouse.up()
        self.assertGreater(float(self.page.locator("#crop-width").input_value()), float(self.page.locator("#crop-height").input_value()))
        # Also check precise numeric sizing and preserved output aspect ratio.
        self.page.locator("#reset-crop").click()
        self.change("#crop-width", 800)
        self.change("#crop-height", 300)
        self.page.locator("#confirm-crop").click()
        self.page.locator(".text-entry input").first.fill("测试 / Test")
        self.page.locator("#image-scale").fill("100")
        self.page.locator("#image-scale").dispatch_event("input")
        self.page.locator("#transparent").check()
        line_color = self.page.locator('.line-style input[type="color"]').first
        line_color.fill("#ff00ff")
        line_color.dispatch_event("input")

        def bounds(image, color):
            mask = Image.new("L", image.size)
            mask.putdata([255 if p[:3] == color and p[3] else 0 for p in image.getdata()])
            return mask.getbbox()

        outside = self.export()
        blue = bounds(outside, (77,129,155))
        text = bounds(outside, (255,0,255))
        self.assertIsNotNone(blue)
        self.assertIsNotNone(text)
        # Blue occupies the right half of the photo; double it to recover the full width.
        self.assertAlmostEqual(2 * (blue[2] - blue[0]) / (blue[3] - blue[1]), 800 / 300, delta=.04)
        self.assertGreaterEqual(text[1], blue[3])
        self.page.locator("#text-position").select_option("inside")
        inside = self.export()
        blue = bounds(inside, (77,129,155))
        text = bounds(inside, (255,0,255))
        self.assertGreaterEqual(text[1], blue[1])
        self.assertLessEqual(text[3], blue[3])
        self.page.locator('.line-style input[type="checkbox"]').first.check()
        self.assertIsNone(bounds(self.export(), (255,0,255)))
        self.page.locator('.line-style input[type="checkbox"]').first.uncheck()
        expect(self.page.locator("#selection-hint")).to_be_attached()
        self.assertEqual(self.page.locator("#selection-hint").locator("xpath=ancestor::*[contains(@class,'preview-toolbar')]").count(), 1)
        self.page.locator(".grid-entry").hover()
        cell_color = self.page.locator('.cell-background-tools input[type="color"]').first
        cell_color.fill("#33cc66")
        cell_color.dispatch_event("input")
        colored = self.export()
        self.assertEqual(colored.getpixel((45,970)), (51,204,102,255))
        self.assertEqual(colored.getpixel((0,0))[3], 0)
        self.page.locator(".grid-entry").hover()
        self.page.locator('.cell-background-tools input[type="checkbox"]').check()
        self.assertEqual(self.export().getpixel((45,970))[3], 0)
        self.page.locator(".grid-entry").hover()
        self.page.locator('.cell-background-tools input[type="checkbox"]').uncheck()
        before_title = self.page.locator(".grid-cell").bounding_box()
        self.page.locator("#page-title").fill("My dolls / 我的珍藏")
        expect(self.page.locator("#page-title")).to_have_value("My dolls / 我的珍藏")
        titled = self.export()
        after_title = self.page.locator(".grid-cell").bounding_box()
        self.assertGreater(after_title["y"], before_title["y"])
        self.assertTrue(any(pixel[3] for pixel in titled.crop((0,0,1024,70)).getdata()))
        project = self.save_project()
        self.assertAlmostEqual(project["dolls"][0]["crop"]["aspect"], 800/300)
        self.assertEqual(project["dolls"][0]["background"], "#33cc66")
        self.assertFalse(project["dolls"][0]["transparent"])
        self.assertEqual(project["settings"]["pageTitle"], "My dolls / 我的珍藏")
        self.page.locator("#page-title").fill("")
        self.page.locator("#text-position").select_option("outside")
        self.page.locator("#project-input").set_input_files({"name":"project.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#text-position")).to_have_value("inside")
        expect(self.page.locator("#page-title")).to_have_value("My dolls / 我的珍藏")
        self.assertEqual(self.save_project(), project)
        self.assertEqual(self.export().tobytes(), titled.tobytes())

    def test_legacy_project_defaults_and_background_follows_swap(self):
        self.page.locator("#photo-input").set_input_files([photo("one.png"), photo("two.png")])
        expect(self.page.locator(".doll-card")).to_have_count(2)
        self.page.locator(".grid-entry").first.hover()
        color = self.page.locator('.cell-background-tools input[type="color"]').first
        color.fill("#abcdef")
        color.dispatch_event("input")
        self.page.locator(".grid-cell").first.drag_to(self.page.locator(".grid-cell").nth(1))
        project = self.save_project()
        self.assertEqual(project["dolls"][1]["background"], "#abcdef")
        self.assertEqual(project["dolls"][1]["name"], "one.png")
        project["settings"].pop("textPosition")
        project["settings"].pop("pageTitle")
        for style in project["settings"]["styles"]:
            style.pop("background")
            style.pop("transparent")
        for doll in project["dolls"]:
            doll.pop("background")
            doll.pop("transparent")
            doll["crop"].pop("aspect")
            doll["crop"].pop("rotation")
        self.page.locator("#project-input").set_input_files({"name":"legacy.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#text-position")).to_have_value("outside")
        expect(self.page.locator("#page-title")).to_have_value("")
        restored = self.save_project()
        self.assertTrue(all(d["transparent"] for d in restored["dolls"]))
        self.assertTrue(all(s["transparent"] for s in restored["settings"]["styles"]))
        self.assertEqual([d["name"] for d in restored["dolls"]], [d["name"] for d in project["dolls"]])

    def test_fixed_ratios_cat_mask_and_rotation(self):
        self.change("#columns", 1)
        self.change("#rows", 1)
        self.change("#width", 512)
        self.change("#height", 512)
        self.page.locator("#transparent").check()
        self.page.locator("#photo-input").set_input_files(photo())
        for index, (shape, ratio) in enumerate([("ratio-4-3",4/3),("ratio-3-2",3/2),("ratio-2-3",2/3),("ratio-3-4",3/4),("ratio-4-5",4/5)]):
            with self.subTest(shape=shape):
                if index:
                    self.page.locator(".card-actions button").first.click()
                self.page.locator(f'input[name="shape"][value="{shape}"]').check()
                expect(self.page.locator("#rectangle-settings")).to_be_hidden()
                self.page.locator("#crop-zoom").fill("1.4")
                self.page.locator("#crop-zoom").dispatch_event("input")
                self.page.locator("#confirm-crop").click()
                image = self.export()
                box = image.getchannel("A").getbbox()
                self.assertAlmostEqual((box[2]-box[0])/(box[3]-box[1]), ratio, delta=.02)
                crop = self.save_project()["dolls"][0]["crop"]
                self.assertEqual(crop["shape"], shape)
                self.assertAlmostEqual(crop["aspect"], ratio)
        self.page.locator(".card-actions button").first.click()
        self.page.locator('input[name="shape"][value="cat"]').check()
        self.page.locator("#reset-crop").click()
        self.page.locator("#confirm-crop").click()
        samples = self.page.locator(".thumbnail").evaluate("""canvas => {
            const ctx=canvas.getContext('2d');
            return [[14,8],[90,8],[52,4],[52,52],[2,2],[52,100]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
        }""")
        self.assertEqual([p[3] for p in samples], [255,255,0,255,0,255], "Cat ears, notch, face and transparent corners")
        cat_image = self.export()
        self.assertEqual(cat_image.getpixel((0,0))[3], 0)
        cat_project = self.save_project()
        self.assertEqual(cat_project["dolls"][0]["crop"]["shape"], "cat")
        self.page.locator(".card-actions button").first.click()
        self.page.locator('input[name="shape"][value="square"]').check()
        self.page.locator("#rotate-right").click()
        expect(self.page.locator("#crop-angle")).to_have_value("90")
        self.page.locator("#confirm-crop").click()
        top, bottom = self.page.locator(".thumbnail").evaluate("""canvas => {
            const ctx=canvas.getContext('2d');
            return [[52,20],[52,84]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
        }""")
        self.assertEqual(top, [219,118,91,255], "90 degree clockwise rotation turns the red left half into the top half")
        self.assertEqual(bottom, [77,129,155,255])
        self.page.locator(".card-actions button").first.click()
        self.page.locator("#rotate-left").click()
        expect(self.page.locator("#crop-angle")).to_have_value("0")
        self.page.locator("#crop-rotation").fill("45")
        self.page.locator("#crop-rotation").dispatch_event("input")
        expect(self.page.locator("#crop-angle")).to_have_value("45")
        self.page.locator("#reset-rotation").click()
        expect(self.page.locator("#crop-angle")).to_have_value("0")
        self.change("#crop-angle", -30)
        self.page.locator("#confirm-crop").click()
        rotated_image = self.export()
        rotated_project = self.save_project()
        self.assertEqual(rotated_project["dolls"][0]["crop"]["rotation"], -30)
        self.page.locator(".card-actions button").first.click()
        self.page.locator("#rotate-right").click()
        self.page.keyboard.press("Escape")
        self.assertEqual(self.save_project(), rotated_project, "Cancel must preserve the saved rotation")
        for project, expected in [(cat_project,cat_image),(rotated_project,rotated_image)]:
            self.page.locator("#project-input").set_input_files({"name":"shapes.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
            self.page.locator('#replace-dialog button[value="open"]').click()
            self.assertEqual(self.save_project(), project)
            self.assertEqual(self.export().tobytes(), expected.tobytes())
        invalid = json.loads(json.dumps(rotated_project))
        invalid["dolls"][0]["crop"]["rotation"] = "90"
        self.page.locator("#project-input").set_input_files({"name":"invalid.json", "mimeType":"application/json", "buffer":json.dumps(invalid).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#status")).to_contain_text("裁剪数据无效")
        self.assertEqual(self.save_project(), rotated_project)

    def test_new_masks_alignment_and_bottom_text(self):
        self.change("#columns", 1)
        self.change("#rows", 1)
        self.change("#width", 512)
        self.change("#height", 512)
        self.page.locator("#transparent").check()
        self.page.locator("#photo-input").set_input_files(photo())
        masks = [
            ("star5", [[52,6],[52,52],[2,2],[52,100]], [True,True,False,False]),
            ("star6", [[52,6],[52,52],[2,2],[52,100]], [True,True,False,True]),
            ("heart", [[52,52],[52,2],[20,20],[2,100]], [True,False,True,False]),
            ("triangle", [[52,15],[52,85],[10,15],[52,100]], [True,True,False,False]),
            ("triangleDown", [[52,15],[52,85],[10,15],[52,100]], [True,True,True,False]),
        ]
        for index, (shape, points, expected) in enumerate(masks):
            if index:
                self.page.locator(".card-actions button").first.click()
            self.page.locator(f'input[name="shape"][value="{shape}"]').check()
            self.page.locator("#confirm-crop").click()
            alpha = self.page.locator(".thumbnail").evaluate("(c,points)=>points.map(([x,y])=>c.getContext('2d').getImageData(x,y,1,1).data[3]>128)", points)
            self.assertEqual(alpha, expected, shape)
            mask_image = self.export()
            project = self.save_project()
            self.assertEqual(project["dolls"][0]["crop"]["shape"], shape)
            self.page.locator("#project-input").set_input_files({"name":"mask.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
            self.page.locator('#replace-dialog button[value="open"]').click()
            self.assertEqual(self.export().tobytes(), mask_image.tobytes())
        self.page.locator(".card-actions button").first.click()
        self.page.locator('input[name="shape"][value="square"]').check()
        self.page.locator("#confirm-crop").click()
        self.page.locator(".text-entry input").first.fill("TEST")
        color = self.page.locator('.line-style input[type="color"]').first
        color.fill("#ff00ff")
        color.dispatch_event("input")

        def background_bounds(image):
            mask = Image.new("L", image.size)
            mask.putdata([255 if pixel[:3] == (255,0,255) and pixel[3] else 0 for pixel in image.getdata()])
            return mask.getbbox()

        boxes = []
        for alignment in ["left", "center", "right"]:
            self.page.locator("#text-align").select_option(alignment)
            boxes.append(background_bounds(self.export()))
            self.assertEqual(self.save_project()["settings"]["textAlign"], alignment)
        self.assertLess(boxes[0][0], boxes[1][0])
        self.assertLess(boxes[1][0], boxes[2][0])
        self.page.locator("#text-align").select_option("center")
        self.page.locator("#text-position").select_option("inside")
        for shape in ["square", "circle", "cat", "heart", "triangleDown", "star5", "star6"]:
            self.page.locator(".card-actions button").first.click()
            self.page.locator(f'input[name="shape"][value="{shape}"]').check()
            self.page.locator("#confirm-crop").click()
            image = self.export()
            text = background_bounds(image)
            photo_box = image.getchannel("A").getbbox()
            self.assertIsNotNone(text, shape)
            self.assertGreater((text[1]+text[3])/2, (photo_box[1]+photo_box[3])/2, shape)
            if shape in ["square", "circle", "cat"]:
                self.assertGreater(text[1], photo_box[1] + (photo_box[3]-photo_box[1]) * .8, shape)
        # Alignment also survives saving and loading a project.
        self.page.locator("#text-align").select_option("right")
        project = self.save_project()
        self.page.locator("#text-align").select_option("left")
        self.page.locator("#project-input").set_input_files({"name":"align.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#text-align")).to_have_value("right")

    def test_white_padding_independent_photo_and_manual_text_position(self):
        self.change("#columns", 1)
        self.change("#rows", 1)
        self.change("#width", 512)
        self.change("#height", 512)
        self.page.locator("#transparent").check()
        self.page.locator("#photo-input").set_input_files(photo())
        self.page.locator('input[name="shape"][value="square"]').check()
        self.page.locator("#crop-zoom").fill("0.5")
        self.page.locator("#crop-zoom").dispatch_event("input")
        self.page.locator("#confirm-crop").click()
        # Smaller than the original crop is now allowed, with opaque white padding.
        pixels = self.page.locator(".thumbnail").evaluate("c=>[[2,2],[52,52]].map(([x,y])=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data))")
        self.assertEqual(pixels[0], [255,255,255,255])
        self.assertNotEqual(pixels[1][:3], [255,255,255])
        self.page.locator(".card-actions button").first.click()
        self.page.locator("#reset-crop").click()
        canvas = self.page.locator("#crop-canvas")
        box = canvas.bounding_box()
        self.page.mouse.move(box["x"]+box["width"]*.5,box["y"]+box["height"]*.5)
        self.page.mouse.down()
        self.page.mouse.move(box["x"]+box["width"]*.5,box["y"]+box["height"]*.8,steps=5)
        self.page.mouse.up()
        self.page.locator("#confirm-crop").click()
        project = self.save_project()
        self.assertLess(project["dolls"][0]["crop"]["y"], 300, "Panning must extend beyond the source photo edge")
        top_pixel = self.page.locator(".thumbnail").evaluate("c=>Array.from(c.getContext('2d').getImageData(52,2,1,1).data)")
        self.assertEqual(top_pixel, [255,255,255,255])
        self.page.locator(".card-actions button").first.click()
        self.page.locator("#reset-crop").click()
        self.page.locator("#confirm-crop").click()
        self.page.locator("#image-scale").fill("100")
        self.page.locator("#image-scale").dispatch_event("input")
        full = self.export()
        photo_box = full.getchannel("A").getbbox()
        for actual, expected in zip(photo_box, (17.92,17.92,494.08,494.08)):
            self.assertAlmostEqual(actual, expected, delta=1)
        self.page.locator("#image-scale").fill("50")
        self.page.locator("#image-scale").dispatch_event("input")
        half_box = self.export().getchannel("A").getbbox()
        self.assertEqual(half_box[1], photo_box[1], "Smaller photos remain top-aligned")
        self.assertAlmostEqual(half_box[3]-half_box[1], (photo_box[3]-photo_box[1])/2, delta=1)
        self.page.locator(".text-entry input").first.fill("TEST")
        color = self.page.locator('.line-style input[type="color"]').first
        color.fill("#ff00ff")
        color.dispatch_event("input")
        def text_box(image):
            mask = Image.new("L", image.size)
            mask.putdata([255 if p[:3]==(255,0,255) else 0 for p in image.getdata()])
            return mask.getbbox()
        bottom = text_box(self.export())
        self.page.locator("#image-scale").fill("100")
        self.page.locator("#image-scale").dispatch_event("input")
        # Edge pixels blend differently over an opaque photo versus a transparent canvas.
        for actual, expected in zip(text_box(self.export()), bottom):
            self.assertAlmostEqual(actual, expected, delta=1, msg="Photo scale must not move or resize outside text")
        self.page.locator("#text-offset").fill("20")
        self.page.locator("#text-offset").dispatch_event("input")
        moved = text_box(self.export())
        self.assertLess(moved[1], bottom[1])
        self.assertAlmostEqual(moved[3]-moved[1],bottom[3]-bottom[1],delta=2)
        project = self.save_project()
        self.assertEqual(project["settings"]["textOffset"],20)
        self.page.locator("#project-input").set_input_files({"name":"layout.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        expect(self.page.locator("#text-offset")).to_have_value("20")
        self.assertEqual(self.save_project(),project)

    def test_cell_line_colors_defaults_overrides_and_compact_controls(self):
        self.change("#columns", 2)
        self.change("#rows", 1)
        self.change("#width", 1024)
        self.change("#height", 512)
        self.change("#line-count", 1)
        self.change('.line-style input[type="number"]',160)
        self.page.locator("#photo-input").set_input_files([photo("one.png"),photo("two.png")])
        expect(self.page.locator(".doll-card")).to_have_count(2)
        for card in self.page.locator(".doll-card").all():
            card.locator(".text-entry input").first.fill("MMMM")
        self.page.locator("#foreground").fill("#112233")
        self.page.locator("#foreground").dispatch_event("input")
        bg = self.page.locator('.line-style input[type="color"]').first
        bg.fill("#ff00ff");bg.dispatch_event("input")
        entry = self.page.locator(".grid-entry").first
        entry.hover()
        entry.locator("summary").click()
        foreground = entry.locator('input[data-field="foreground"][data-line="0"]')
        background = entry.locator('input[data-field="background"][data-line="0"]')
        foreground.fill("#ff0000");foreground.dispatch_event("input")
        background.fill("#00ffff");background.dispatch_event("input")
        def has_color(image, color, half):
            box=(0,0,512,512) if half==0 else (512,0,1024,512)
            return color in image.crop(box).getdata()
        image = self.export()
        self.assertTrue(has_color(image,(255,0,0,255),0))
        self.assertTrue(has_color(image,(0,255,255,255),0))
        self.assertTrue(has_color(image,(17,34,51,255),1))
        self.assertTrue(has_color(image,(255,0,255,255),1))
        self.assertFalse(has_color(image,(0,255,255,255),1))
        self.page.locator("#foreground").fill("#00aa00")
        self.page.locator("#foreground").dispatch_event("input")
        image = self.export()
        self.assertTrue(has_color(image,(255,0,0,255),0),"Custom text must keep its own color")
        self.assertTrue(has_color(image,(0,170,0,255),1),"Default text must follow the global color")
        project = self.save_project()
        self.assertEqual(project["dolls"][0]["lineColors"][0],{"foreground":"#ff0000","background":"#00ffff"})
        self.assertEqual(project["dolls"][1]["lineColors"][0],{"foreground":None,"background":None})
        entry.hover()
        entry.locator('select[data-field="foreground"]').select_option("default")
        entry.locator('select[data-field="background"]').select_option("transparent")
        image = self.export()
        self.assertTrue(has_color(image,(0,170,0,255),0))
        self.assertFalse(has_color(image,(0,255,255,255),0))
        self.assertFalse(has_color(image,(255,0,255,255),0))
        entry.hover()
        entry.locator('select[data-field="background"]').select_option("default")
        self.assertTrue(has_color(self.export(),(255,0,255,255),0))
        self.page.locator("#project-input").set_input_files({"name":"colors.json", "mimeType":"application/json", "buffer":json.dumps(project).encode()})
        self.page.locator('#replace-dialog button[value="open"]').click()
        self.assertEqual(self.save_project(),project)
        # The original three-line settings and layout options occupy the same desktop row.
        self.change("#line-count",3)
        controls=[self.page.locator(selector).first.bounding_box() for selector in ["#line-count","#text-position","#text-align","#text-offset",".line-style"]]
        self.assertLess(max(b["y"] for b in controls)-min(b["y"] for b in controls),55)
        self.assertLess(self.page.locator(".settings-panel").bounding_box()["height"],330)
        self.page.set_viewport_size({"width":390,"height":844})
        entry=self.page.locator(".grid-entry").first
        entry.locator("summary").click(force=True)
        self.page.wait_for_timeout(50)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

    def test_languages_filenames_and_content_preservation(self):
        self.page.reload()
        expect(self.page.locator("html")).to_have_attribute("lang", "ja")
        expect(self.page.locator("#language-switcher button")).to_have_text(["中文", "ENGLISH", "한국어"])
        expect(self.page).to_have_title("ドール紹介 · Dollfolio")
        self.page.locator("#photo-input").set_input_files([photo("one.png"), photo("two.png")])
        expect(self.page.locator(".doll-card")).to_have_count(2)
        self.page.locator(".text-entry input").nth(0).fill("雪 / Snow / 눈")
        self.change("#width", 512)
        self.change("#height", 512)
        self.page.locator(".grid-cell").first.click()
        baseline = None
        pixels = None
        locales = [
            ("en", "en", ["日本語", "中文", "한국어"], "Open project", "Doll name", "doll-introduction", "doll-introduction-project"),
            ("ko", "ko", ["日本語", "中文", "ENGLISH"], "프로젝트 열기", "인형 이름", "인형소개", "인형소개-프로젝트"),
            ("zh", "zh-CN", ["日本語", "ENGLISH", "한국어"], "打开项目", "人偶名字", "人偶介绍", "人偶介绍项目"),
            ("ja", "ja", ["中文", "ENGLISH", "한국어"], "プロジェクトを開く", "ドールの名前", "ドール紹介", "ドール紹介プロジェクト"),
        ]
        for code, html, labels, open_label, placeholder, image_prefix, project_prefix in locales:
            with self.subTest(language=code):
                self.page.locator(f'[data-language="{code}"]').click()
                expect(self.page.locator("html")).to_have_attribute("lang", html)
                expect(self.page.locator("#language-switcher button")).to_have_text(labels)
                expect(self.page.locator(f'#language-switcher [data-language="{code}"]')).to_have_count(0)
                expect(self.page.locator("#open-project")).to_have_text(open_label)
                expect(self.page.locator(".text-entry input").first).to_have_value("雪 / Snow / 눈")
                expect(self.page.locator(".text-entry input").first).to_have_attribute("placeholder", placeholder)
                expect(self.page.locator(".grid-cell").first).to_have_attribute("aria-pressed", "true")
                with self.page.expect_download() as event:
                    self.page.locator("#save-project").click()
                self.assertRegex(event.value.suggested_filename, f"^{project_prefix}-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}\\.json$")
                project = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
                if baseline is None:
                    baseline = project
                self.assertEqual(project, baseline)
                with self.page.expect_download() as event:
                    self.page.locator("#export").click()
                self.assertRegex(event.value.suggested_filename, f"^{image_prefix}-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}\\.png$")
                with Image.open(event.value.path()) as image:
                    current = image.convert("RGBA").tobytes()
                if pixels is None:
                    pixels = current
                self.assertEqual(current, pixels, "Language switches must preserve user artwork")
                self.page.locator(".card-actions button").first.click()
                for selector in ["#crop-title", "#reset-crop", "#confirm-crop"]:
                    self.assertTrue(self.page.locator(selector).inner_text().strip())
                self.page.keyboard.press("Escape")
                self.page.set_viewport_size({"width":390,"height":844})
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), code)
                self.page.set_viewport_size({"width":1440,"height":1050})

    def test_localized_validation_toasts_and_project_confirmation(self):
        # The same visible message must change immediately when switching language.
        self.page.locator("#photo-input").set_input_files({"name":"bad.svg", "mimeType":"image/svg+xml", "buffer":b"<svg/>"})
        expect(self.page.locator("#status")).to_contain_text("不是支持的图片格式")
        self.page.locator('[data-language="en"]').click()
        expect(self.page.locator("#status")).to_have_text("bad.svg is not a supported image format.")
        self.page.locator('[data-language="ko"]').click()
        expect(self.page.locator("#status")).to_contain_text("지원하지 않는 이미지 형식")
        self.page.locator('[data-language="ja"]').click()
        expect(self.page.locator("#status")).to_contain_text("対応していない画像形式")
        self.page.locator("#photo-input").set_input_files(photo())
        self.page.locator("#confirm-crop").click()
        project = self.save_project()
        for code, label, error in [
            ("en", "Open another project?", "The project's Columns setting is invalid."),
            ("ko", "다른 프로젝트를 여시겠습니까?", "프로젝트의 ‘열 수’ 설정이 유효하지 않습니다."),
            ("zh", "打开项目？", "项目中的“列数”设置无效。"),
            ("ja", "プロジェクトを開きますか？", "プロジェクトの「列数」設定が無効です。"),
        ]:
            with self.subTest(language=code):
                self.page.locator(f'[data-language="{code}"]').click()
                invalid = json.loads(json.dumps(project))
                invalid["settings"]["columns"] = 0
                self.page.locator("#project-input").set_input_files({"name":"bad.json", "mimeType":"application/json", "buffer":json.dumps(invalid).encode()})
                expect(self.page.locator("#replace-title")).to_have_text(label)
                self.page.locator('#replace-dialog button[value="open"]').click()
                expect(self.page.locator("#status")).to_have_text(error)
                self.assertEqual(self.save_project(), project)
        # Every translation is complete and uses the same interpolation variables.
        problems = self.page.evaluate("""() => Object.entries(DollfolioI18n.messages).flatMap(([key, values]) => {
            const params = value => (value.match(/\\{\\w+\\}/g) || []).sort().join(',');
            return values.length !== 4 || values.some(value => typeof value !== 'string' || (!value.length && key !== 'messageSeparator') || params(value) !== params(values[0])) ? [key] : [];
        })""")
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
