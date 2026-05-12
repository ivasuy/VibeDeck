class Vibedeck < Formula
  desc "Local-first usage and provenance dashboard for AI coding agents"
  homepage "https://github.com/ivasuy/vibedeck"
  url "https://registry.npmjs.org/vibedeck-cli/-/vibedeck-cli-0.6.1.tgz"
  sha256 "REPLACE_IN_RELEASE"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    system bin/"vibedeck", "--help"
    # Postinstall script in package.json performs the VibeDeck bootstrap flow.
    system "node", "scripts/npm-postinstall.js"
  end
end
