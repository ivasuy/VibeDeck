class Vibedeck < Formula
  desc "Local-first usage and provenance dashboard for AI coding agents"
  homepage "https://github.com/ivasuy/vibedeck"
  url "https://registry.npmjs.org/vibedeck-cli/-/vibedeck-cli-0.1.3.tgz"
  sha256 "REPLACE_IN_RELEASE"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/vibedeck"
  end

  test do
    assert_match "vibedeck", shell_output("#{bin}/vibedeck --help")
  end
end
