"""Verify literal secret handling in the locally built production image."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class StarterEntrypointTests(unittest.TestCase):
    def test_literal_secret_entrypoint(self):
        # Values are data even when they look like shell syntax; never eval/source.
        value = "$(touch /tmp/neander-entrypoint-executed) equals= quote'\" # dollar$"
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp) / "environment"
            bundle.write_text(f"SENTINEL={value}\n")
            bundle.chmod(0o644)  # Fake sentinel readable by each non-root image user.
            command = ["node", "-e", "if(require('fs').existsSync('/tmp/neander-entrypoint-executed'))process.exit(2);process.stdout.write(process.env.SENTINEL)"]
            result = subprocess.run([
                "docker", "run", "--rm", "-v", f"{bundle}:/run/secrets/neander_environment:ro",
                "neander-starter-nextjs:local", *command,
            ], capture_output=True, text=True, timeout=30, check=True)
            self.assertEqual(result.stdout, value)


if __name__ == "__main__":
    unittest.main()
