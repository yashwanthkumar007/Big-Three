"""
Application entry point. CLI — run a Master/Sample comparison and save
the results as CSV reports.

Usage:
    python application.py --master "Data/Master/file.pdf" --sample "Data/Sample/file.pdf"
"""

import argparse
import os
import sys

sys.path.append(os.path.dirname(__file__))
from src.pipelines.comparison_pipeline import run_text_inspection, save_report
from src.logger import logger


def main():
    parser = argparse.ArgumentParser(description="GlobalVision Replace — Text Inspection")
    parser.add_argument("--master", required=True, help="Path to Master (approved) PDF")
    parser.add_argument("--sample", required=True, help="Path to Sample (new/revised) PDF")
    parser.add_argument(
        "--output",
        default=os.path.join("Data", "Output", "Reports"),
        help="Directory to save CSV reports (default: Data/Output/Reports)",
    )
    args = parser.parse_args()

    result = run_text_inspection(args.master, args.sample)
    save_report(result, args.output)

    findings = result["findings"]
    location_groups = result["location_groups"]
    stats = result["match_stats"]

    print(f"\nText Inspection complete.")
    print(f"Matched pairs: {stats['matched_pairs']}")
    print(f"Unmatched master (Deletion candidates): {stats['unmatched_master']}")
    print(f"Unmatched sample (Insertion candidates): {stats['unmatched_sample']}")
    print(f"\nFindings: {len(findings)}")
    print(f"Location groups (summarized shifts): {len(location_groups)}")
    print(f"\nReports saved to: {args.output}\n")

    for i, f in enumerate(findings, 1):
        print("=" * 100)
        print(f"Finding {i}")
        print(f"Page    : {f['page']}")
        print(f"Type    : {f['type']}")
        print(f"Master  : {f['master']}")
        print(f"Sample  : {f['sample']}")
        print(f"Comment : {f['comment']}")
        print("=" * 100)

    if location_groups:
        print("\n" + "=" * 100)
        print("LOCATION GROUPS (summarized — many similar shifts collapsed into one)")
        print("=" * 100)
        for g in location_groups:
            print(f"Shift {g['shift']}: {g['count']} item(s) — e.g. {g['sample_members'][0]['master']!r}")


if __name__ == "__main__":
    main()