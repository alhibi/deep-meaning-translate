"""Optional system Chromium for restricted/offline test environments."""
import json
import os


async def launch_chromium(playwright):
    return await playwright.chromium.launch(
        headless=True,
        executable_path=os.environ.get("CHROMIUM_PATH"),
        args=json.loads(os.environ.get("CHROMIUM_ARGS", "[]")),
    )
