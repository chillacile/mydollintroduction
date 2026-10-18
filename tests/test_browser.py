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
        self.change(".line-style:nth-child(2) input", 55)
        self.page.locator("#image-scale").fill("70")
        self.page.locator("#image-scale").dispatch_event("input")
        self.page.locator("#text-scale").fill("120")
        self.page.locator("#text-scale").dispatch_event("input")
        self.change("#width", 2048)
        original = self.save_project()
        self.assertEqual(original["settings"]["styles"][1], {"font": "kai", "size": 55})
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
