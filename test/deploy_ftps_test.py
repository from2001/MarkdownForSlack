"""Check destination restrictions, publication order and interrupted uploads."""

import importlib.util
from pathlib import Path
import ssl
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("deploy_ftps", Path(__file__).parents[1] / "scripts/deploy-ftps.py")
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.settings = {
            "FTP_HOST": "ftp.example.com",
            "FTP_USERNAME": "example",
            "FTP_PASSWORD": "test-only-password",
            "FTP_REMOTE_DIR": "/home/example/www/web/MarkdownForSlack/",
        }
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        for file in deployment.FILES:
            path = self.directory / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"sample asset")

    def fake_client(self, fail_upload=False):
        events = []

        class Client:
            def __init__(self, *, context, timeout):
                assert context.verify_mode == ssl.CERT_REQUIRED
                assert context.check_hostname

            def connect(self, *args): events.append(("connect", args))
            def login(self, *args): events.append(("login",))
            def prot_p(self): events.append(("encrypted-data",))
            def set_pasv(self, passive): events.append(("passive", passive))
            def cwd(self, path): events.append(("cwd", path))
            def storbinary(self, command, stream):
                events.append(("upload", command, stream.read()))
                if fail_upload:
                    raise OSError("Connection lost")
            def rename(self, source, target): events.append(("publish", source, target))
            def delete(self, path): events.append(("delete", path))
            def close(self): events.append(("close",))

        return Client, events

    def test_no_connection_with_missing_settings_or_broad_destination(self):
        for settings in ({}, {**self.settings, "FTP_REMOTE_DIR": "/home/example/www"},
                         {**self.settings, "FTP_REMOTE_DIR": "../MarkdownForSlack"},
                         {**self.settings, "FTP_HOST": "ftp://ftp.example.com"}):
            client, events = self.fake_client()
            with self.assertRaises(ValueError):
                deployment.deploy(settings, client, self.directory)
            self.assertEqual(events, [])

    def test_all_uploads_complete_before_publish_and_index_is_last(self):
        client, events = self.fake_client()
        deployment.deploy(self.settings, client, self.directory)
        uploads = [event for event in events if event[0] == "upload"]
        published = [event for event in events if event[0] == "publish"]
        self.assertEqual(len(uploads), len(deployment.FILES))
        self.assertEqual({event[2] for event in published}, set(deployment.FILES))
        self.assertEqual(published[-1][2], "index.html")
        self.assertLess(max(index for index, event in enumerate(events) if event[0] == "upload"),
                        min(index for index, event in enumerate(events) if event[0] == "publish"))
        self.assertIn(("encrypted-data",), events)
        self.assertFalse(any(event[0] == "delete" for event in events))

    def test_failed_transfer_keeps_live_files_and_cleans_only_own_temporary_files(self):
        client, events = self.fake_client(fail_upload=True)
        with self.assertRaises(OSError):
            deployment.deploy(self.settings, client, self.directory)
        self.assertFalse(any(event[0] == "publish" for event in events))
        removed = [event[1] for event in events if event[0] == "delete"]
        self.assertEqual(len(removed), 1)
        self.assertIn(".upload-", removed[0])
        self.assertEqual(events[-1], ("close",))


if __name__ == "__main__":
    unittest.main()
