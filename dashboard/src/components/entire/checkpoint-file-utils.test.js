import { describe, expect, it } from "vitest";
import {
  checkpointFileIconName,
  checkpointFileLabel,
  groupCheckpointFiles,
  repoChipParts,
} from "./checkpoint-file-utils";

describe("checkpoint-file-utils", () => {
  it("groups checkpoint files by checkpoint id prefix", () => {
    const groups = groupCheckpointFiles([
      "06/e2abdc1ec6/metadata.json",
      "06/e2abdc1ec6/0/full.jsonl",
      "06/e2abdc1ec6/0/prompt.txt",
      "23/183a892518/1/content_hash.txt",
    ]);

    expect(groups).toEqual([
      {
        id: "06/e2abdc1ec6",
        label: "06/e2abdc1ec6",
        files: [
          "06/e2abdc1ec6/metadata.json",
          "06/e2abdc1ec6/0/prompt.txt",
          "06/e2abdc1ec6/0/full.jsonl",
        ],
      },
      {
        id: "23/183a892518",
        label: "23/183a892518",
        files: ["23/183a892518/1/content_hash.txt"],
      },
    ]);
  });

  it("sorts with preferred known files first then alphabetically", () => {
    const groups = groupCheckpointFiles([
      "06/e2abdc1ec6/0/zz.txt",
      "06/e2abdc1ec6/0/content_hash.txt",
      "06/e2abdc1ec6/metadata.json",
      "06/e2abdc1ec6/0/full.jsonl",
      "06/e2abdc1ec6/0/aa.txt",
      "06/e2abdc1ec6/0/prompt.txt",
    ]);

    expect(groups[0].files).toEqual([
      "06/e2abdc1ec6/metadata.json",
      "06/e2abdc1ec6/0/prompt.txt",
      "06/e2abdc1ec6/0/full.jsonl",
      "06/e2abdc1ec6/0/content_hash.txt",
      "06/e2abdc1ec6/0/aa.txt",
      "06/e2abdc1ec6/0/zz.txt",
    ]);
  });

  it("labels checkpoint file types", () => {
    expect(checkpointFileLabel("06/e2abdc1ec6/metadata.json")).toBe("Metadata");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/full.jsonl")).toBe("JSONL");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/prompt.txt")).toBe("Prompt");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/content_hash.txt")).toBe("Hash");
    expect(checkpointFileLabel("sample.json")).toBe("JSON");
    expect(checkpointFileLabel("sample.jsonl")).toBe("JSONL");
    expect(checkpointFileLabel("sample.txt")).toBe("Text");
    expect(checkpointFileLabel("sample.bin")).toBe("File");
  });

  it("maps file types to stable icon names", () => {
    expect(checkpointFileIconName("metadata.json")).toBe("json");
    expect(checkpointFileIconName("full.jsonl")).toBe("jsonl");
    expect(checkpointFileIconName("prompt.txt")).toBe("text");
    expect(checkpointFileIconName("content_hash.txt")).toBe("hash");
    expect(checkpointFileIconName("archive.tar")).toBe("file");
  });

  it("builds readable repo chip labels from absolute paths", () => {
    expect(repoChipParts("/Users/vasuyadav/Downloads/Projects/switchyard")).toEqual({
      name: "switchyard",
      context: "Projects",
      fullPath: "/Users/vasuyadav/Downloads/Projects/switchyard",
    });
  });

  it("handles empty/invalid inputs defensively", () => {
    expect(groupCheckpointFiles()).toEqual([]);
    expect(groupCheckpointFiles([null, "", "  "])).toEqual([]);
    expect(repoChipParts("")).toEqual({ name: "", context: "", fullPath: "" });
    expect(repoChipParts(null)).toEqual({ name: "", context: "", fullPath: "" });
  });
});
