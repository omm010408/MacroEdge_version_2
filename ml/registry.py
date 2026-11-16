from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.config import ARTIFACTS_DIR, REPORTS_DIR


REGISTRY_DIR = ARTIFACTS_DIR / "registry_versions"
EXPERIMENT_INDEX = ARTIFACTS_DIR / "training_runs" / "experiment_registry.json"


def get_environment_metadata() -> dict[str, Any]:
    deps = [
        "numpy",
        "pandas",
        "scipy",
        "scikit-learn",
        "xgboost",
        "torch",
        "transformers",
        "joblib",
    ]
    installed_deps: dict[str, str] = {}
    for d in deps:
        try:
            installed_deps[d] = importlib.metadata.version(d)
        except Exception:
            installed_deps[d] = "unavailable"

    git_hash = "unknown"
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if res.returncode == 0:
            git_hash = res.stdout.strip()
    except Exception:
        pass

    return {
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "git_commit": git_hash,
        "dependencies": installed_deps,
    }


def compile_experiment_registry(version: str = "v1.0.0") -> dict[str, Any]:
    env_meta = get_environment_metadata()
    runs_dir = ARTIFACTS_DIR / "training_runs"

    m1_path = runs_dir / "model1_run.json"
    m2_path = runs_dir / "model2_run.json"
    m3_path = runs_dir / "model3_run.json"
    m4_path = runs_dir / "model4_regime_run.json"

    m1_run = json.loads(m1_path.read_text("utf-8")) if m1_path.exists() else {}
    m2_run = json.loads(m2_path.read_text("utf-8")) if m2_path.exists() else {}
    m3_run = json.loads(m3_path.read_text("utf-8")) if m3_path.exists() else {}
    m4_run = json.loads(m4_path.read_text("utf-8")) if m4_path.exists() else {}

    leakage_audit_path = REPORTS_DIR / "leakage_audit_results.json"
    leakage_audit = json.loads(leakage_audit_path.read_text("utf-8")) if leakage_audit_path.exists() else {}

    m1_inds = m1_run.get("indicators", {})
    m3_horizons = m3_run.get("horizons", {})
    m4_metrics = m4_run.get("summary_metrics", {}) or m4_run.get("directional_evaluation", {})

    models_meta = {
        "model1_economic_forecast": {
            "name": "Economic Forecast Model",
            "version": f"{version}-m1",
            "targets": list(m1_inds.keys()),
            "evaluation_scheme": "Chronological walk-forward (TimeSeriesSplit dev) + untouched 24m holdout",
            "conformal_calibration": "Causal trailing-60 conformal prediction interval pad",
            "consensus_handling": "Explicit value vs surprise separation (free FRED lacks historical survey consensus)",
            "random_seeds": [42],
            "dataset_version": "fred_macro_monthly_v1.0",
            "summary_metrics": {
                t: {
                    "selected_model": meta.get("selected_model"),
                    "dev_mae": meta.get("metrics", {}).get("dev_wf_mae"),
                    "holdout_mae": meta.get("metrics", {}).get("holdout_mae"),
                    "holdout_mase": meta.get("metrics", {}).get("holdout_mase"),
                    "interval_80_coverage": meta.get("metrics", {}).get("interval_80_coverage"),
                }
                for t, meta in m1_inds.items()
            },
        },
        "model2_news_intelligence": {
            "name": "News Intelligence Model",
            "version": f"{version}-m2",
            "backbone": "ProsusAI/finbert (pretrained transformer) + deterministic 12-field extractor",
            "dataset": "45 real Federal Reserve & BLS RSS items (23 manually audited, 22 pending review)",
            "training_policy": "Zero synthetic training/eval leakage (no synthetic corpus CV)",
            "gemini_api_status": "Conditional fallback active (API key optional)",
            "random_seeds": [42],
            "metrics": m2_run.get("flat_metrics", {}),
        },
        "model3_market_reaction": {
            "name": "Market Reaction Model",
            "version": f"{version}-m3",
            "horizons": {
                "5m": "BLOCKED (Yahoo 60d intraday restriction, 0 synthetic bridging)",
                "30m": "BLOCKED (Yahoo 60d intraday restriction, 0 synthetic bridging)",
                "4h": "CONDITIONALLY_READY (134 real observed event windows, Yahoo 1h bars)",
                "1d": "CONDITIONALLY_READY (1,450 real observed event dates, 1999-2026)",
            },
            "event_leakage_embargo": "Event-date grouped PurgedGroupTimeSeriesSplit (embargo_calendar_days=2)",
            "random_seeds": [42],
            "dataset_version": "xauusd_macro_events_v1.0",
            "baseline_comparison": {
                h: {
                    "status": data.get("status"),
                    "total_real_events": data.get("total_real_events", data.get("total_events")),
                    "dev_oof": data.get("dev_walk_forward_oof", {}).get("selected_ensemble"),
                    "holdout": data.get("untouched_final_holdout", {}).get("selected_ensemble"),
                    "blocked_reason": data.get("reason"),
                }
                for h, data in m3_horizons.items()
            },
        },
        "model4_macro_regime_bias": {
            "name": "Macro Regime + Bias Engine",
            "version": f"{version}-m4",
            "regime_models": [
                "Transparent Macro Rules (6-factor score)",
                "Expanding K-Means (K=4)",
                "Expanding GMM (Full Covariance, K=4)",
                "Causal Gaussian HMM (Strictly causal forward filtering, Dirichlet transition prior)",
            ],
            "sample_span": "1,177 weekly business weeks (2004-2026)",
            "validation_split": "813 weeks dev walk-forward (2009-2024) + 104 weeks untouched holdout (2024-2026)",
            "embargo_gap": "4-week purge gap (idx - 4)",
            "random_seeds": [42],
            "stability_metrics": m4_run.get("stability_comparison", {}),
            "performance_metrics": m4_metrics,
        },
    }

    registry_entry = {
        "registry_version": version,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "environment": env_meta,
        "leakage_audit": leakage_audit.get("counts", {}),
        "models": models_meta,
    }

    EXPERIMENT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    EXPERIMENT_INDEX.write_text(json.dumps(registry_entry, indent=2), encoding="utf-8")

    # Refresh training_summary.json for UI / service consumers
    training_summary = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "registry_version": version,
        "environment": env_meta,
        "leakage_audit_status": leakage_audit.get("counts", {}),
        "model1": m1_run.get("targets", {}),
        "model2": m2_run,
        "model3": m3_run,
        "model4": m4_run.get("metrics", {}),
    }
    (REPORTS_DIR / "training_summary.json").write_text(
        json.dumps(training_summary, indent=2), encoding="utf-8"
    )

    return registry_entry


def snapshot_artifacts(version: str = "v1.0.0") -> Path:
    target_dir = REGISTRY_DIR / version
    target_dir.mkdir(parents=True, exist_ok=True)

    artifact_subdirs = [
        "model1_economic_forecast",
        "model2_news_intelligence",
        "model3_market_reaction",
        "model4_macro_regime",
        "macro_regime",
    ]
    for sub in artifact_subdirs:
        src = ARTIFACTS_DIR / sub
        dst = target_dir / sub
        if src.exists():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)

    # Copy metadata and latest inference snapshot
    for fname in ["latest_inference.json"]:
        p = ARTIFACTS_DIR / fname
        if p.exists():
            shutil.copy2(p, target_dir / fname)

    # Save manifest
    manifest = {
        "version": version,
        "snapshotted_at": datetime.now(timezone.utc).isoformat(),
        "environment": get_environment_metadata(),
    }
    (target_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return target_dir


def rollback_to_version(version: str) -> bool:
    src_dir = REGISTRY_DIR / version
    if not src_dir.exists():
        print(f"Error: Version '{version}' not found in registry at {REGISTRY_DIR}")
        return False

    artifact_subdirs = [
        "model1_economic_forecast",
        "model2_news_intelligence",
        "model3_market_reaction",
        "model4_macro_regime",
        "macro_regime",
    ]
    for sub in artifact_subdirs:
        src = src_dir / sub
        dst = ARTIFACTS_DIR / sub
        if src.exists():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)

    if (src_dir / "latest_inference.json").exists():
        shutil.copy2(src_dir / "latest_inference.json", ARTIFACTS_DIR / "latest_inference.json")

    print(f"Successfully rolled back model artifacts to version '{version}'.")
    return True


def list_registry_versions() -> list[str]:
    if not REGISTRY_DIR.exists():
        return []
    return sorted([d.name for d in REGISTRY_DIR.iterdir() if d.is_dir()])


def main() -> None:
    parser = argparse.ArgumentParser(description="MacroEdge Model Registry & Experiment Tracker.")
    parser.add_argument("--version", type=str, default="v1.0.0", help="Registry release version tag.")
    parser.add_argument("--snapshot", action="store_true", help="Snapshot current artifacts to registry.")
    parser.add_argument("--rollback", type=str, default="", help="Rollback deployment artifacts to specified version.")
    parser.add_argument("--list", action="store_true", help="List registered artifact snapshot versions.")
    args = parser.parse_args()

    if args.list:
        versions = list_registry_versions()
        print(f"Available Registry Versions ({len(versions)}): {versions}")
        return

    if args.rollback:
        success = rollback_to_version(args.rollback)
        if not success:
            exit(1)
        return

    reg_entry = compile_experiment_registry(version=args.version)
    print(f"Experiment Registry compiled for version: {args.version}")
    print(json.dumps(reg_entry, indent=2))

    if args.snapshot:
        snap_path = snapshot_artifacts(version=args.version)
        print(f"Saved deployment artifact snapshot to: {snap_path}")


if __name__ == "__main__":
    main()
