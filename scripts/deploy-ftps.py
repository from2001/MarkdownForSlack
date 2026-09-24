"""Upload only the staged public assets through certificate-verified explicit FTPS."""

import ftplib
import json
import os
from pathlib import Path, PurePosixPath
import re
import ssl
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
FILES = json.loads((ROOT / "scripts/deploy-files.json").read_text())


class ReusingFTP_TLS(ftplib.FTP_TLS):
    """Reuse the authenticated TLS session on passive data connections."""

    def ntransfercmd(self, cmd, rest=None):
        connection, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            connection = self.context.wrap_socket(
                connection, server_hostname=self.host, session=self.sock.session
            )
        return connection, size


def configuration(environment):
    names = ("FTP_HOST", "FTP_USERNAME", "FTP_PASSWORD", "FTP_REMOTE_DIR")
    missing = [name for name in names if not environment.get(name)]
    if missing:
        raise ValueError("Configure these GitHub Actions settings (FTP_PASSWORD is a secret; the others are variables): " + ", ".join(missing))
    host, username, password, directory = (environment[name] for name in names)
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host):
        raise ValueError("FTP_HOST must be a hostname without a scheme, port or path")
    if any(character in username + password + directory for character in "\r\n\0"):
        raise ValueError("Deployment settings must not contain control characters")
    if ".." in directory.split("/") or PurePosixPath(directory).name != "MarkdownForSlack":
        raise ValueError("FTP_REMOTE_DIR must point specifically to the MarkdownForSlack directory")
    return host, username, password, directory


def deploy(environment=os.environ, factory=ReusingFTP_TLS, directory=ROOT / ".deploy"):
    host, username, password, remote = configuration(environment)
    for file in FILES:
        if not (directory / file).is_file():
            raise ValueError("Missing staged asset; run npm run build:deploy first: " + file)

    # An interrupted upload cannot replace a live file with a truncated payload.
    suffix = ".upload-" + uuid.uuid4().hex
    pending = []
    client = factory(context=ssl.create_default_context(), timeout=30)
    try:
        client.connect(host, 21)
        client.login(username, password)
        client.prot_p()
        client.set_pasv(True)
        # Require the existing destination rather than creating a guessed document root.
        client.cwd(remote)
        try:
            client.cwd("vendor")
        except ftplib.error_perm:
            client.mkd("vendor")
        else:
            client.cwd("..")

        # Upload every asset before publishing any of them. Publish the entry page last.
        ordered = [file for file in FILES if file != "index.html"] + ["index.html"]
        for file in ordered:
            temporary = file + suffix
            pending.append(temporary)
            with (directory / file).open("rb") as stream:
                client.storbinary("STOR " + temporary, stream)
            print("Uploaded " + file, flush=True)
        for file in ordered:
            temporary = file + suffix
            client.rename(temporary, file)
            pending.remove(temporary)
            print("Published " + file, flush=True)
    finally:
        # Clean up only temporary files created by this run, never unrelated server files.
        for temporary in pending:
            try:
                client.delete(temporary)
            except (OSError, ftplib.Error):
                pass
        client.close()


if __name__ == "__main__":
    try:
        if "--check" in sys.argv:
            configuration(os.environ)
            print("Deployment settings are present")
        else:
            deploy()
    except (ValueError, OSError, ftplib.Error) as error:
        # Server responses are not printed because some servers echo account details.
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        else:
            print(f"FTPS deployment failed ({type(error).__name__}). Check the connection settings and destination permissions.", file=sys.stderr)
        sys.exit(1)
