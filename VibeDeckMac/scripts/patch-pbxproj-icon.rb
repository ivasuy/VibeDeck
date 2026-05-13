#!/usr/bin/env ruby
# frozen_string_literal: true

# patch-pbxproj-icon.rb
# Injects AppIcon.icon (Icon Composer format) into the Xcode project
# as a proper folder.iconcomposer.icon file reference in the Resources build phase.
#
# Run after `xcodegen generate`:
#   ruby scripts/patch-pbxproj-icon.rb

require 'securerandom'

PBXPROJ = File.join(__dir__, '..', 'VibeDeckMac.xcodeproj', 'project.pbxproj')
ICON_RELATIVE_PATH = 'VibeDeckMac/AppIcon.icon'

def gen_id
  SecureRandom.hex(12).upcase
end

content = File.read(PBXPROJ)

# Skip if already patched
if content.include?('folder.iconcomposer.icon')
  puts "Already patched — AppIcon.icon reference exists."
  exit 0
end

file_ref_id = gen_id
build_file_id = gen_id

# 1. Add PBXFileReference for AppIcon.icon (before End PBXFileReference)
file_ref_line = "\t\t#{file_ref_id} /* AppIcon.icon */ = {isa = PBXFileReference; lastKnownFileType = folder.iconcomposer.icon; path = #{ICON_RELATIVE_PATH}; sourceTree = SOURCE_ROOT; };\n"

file_ref_added = content.sub!('/* End PBXFileReference section */') do |m|
  "#{file_ref_line}#{m}"
end
raise 'Failed to add AppIcon.icon file reference' unless file_ref_added

# 2. Add PBXBuildFile for AppIcon.icon in Resources (before End PBXBuildFile)
build_file_line = "\t\t#{build_file_id} /* AppIcon.icon in Resources */ = {isa = PBXBuildFile; fileRef = #{file_ref_id} /* AppIcon.icon */; };\n"

build_file_added = content.sub!('/* End PBXBuildFile section */') do |m|
  "#{build_file_line}#{m}"
end
raise 'Failed to add AppIcon.icon build file' unless build_file_added

# 3. Add to the VibeDeckMac group's children without relying on generated IDs.
group_regex = /
  (\t\t[0-9A-F]{24}\s+\/\*\s+VibeDeckMac\s+\*\/\s+=\s+\{\n
  .*?
  \t\t\tchildren\s=\s\(\n)
  (.*?)
  (\t\t\t\);\n
  \t\t\tpath\s=\sVibeDeckMac;\n
  \t\t\tsourceTree\s=\s"<group>";\n
  \t\t\};)
/mx

group_updated = content.sub!(group_regex) do
  prefix = Regexp.last_match(1)
  existing_children = Regexp.last_match(2)
  suffix = Regexp.last_match(3)
  "#{prefix}#{existing_children}\t\t\t\t#{file_ref_id} /* AppIcon.icon */,\n#{suffix}"
end
raise 'Failed to attach AppIcon.icon to VibeDeckMac group' unless group_updated

# 4. Add to PBXResourcesBuildPhase files list
# Insert into the files = ( ... ) array
# Match the Resources build phase files list and append our entry
resources_updated = content.sub!(/(isa = PBXResourcesBuildPhase;.*?files = \()([^)]*)\)/m) do
  prefix = $1
  existing = $2.rstrip
  "#{prefix}#{existing}\n\t\t\t\t#{build_file_id} /* AppIcon.icon in Resources */,\n\t\t\t)"
end
raise 'Failed to add AppIcon.icon to Resources build phase' unless resources_updated

File.write(PBXPROJ, content)
puts "Patched: AppIcon.icon added as folder.iconcomposer.icon resource"
