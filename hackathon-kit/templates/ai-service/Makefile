# AI Service — common commands. Works without an API key (mock mode).
#   make install && make dev
PYTHON  ?= python3
VENV    ?= .venv
BIN     := $(VENV)/bin
PORT    ?= 8000
TASK    ?= moderation
DATASET ?= evals/datasets/moderation_sample.jsonl
CSV     ?= ml/sample_telemetry.csv
TARGET  ?= is_bot
ARGS    ?=

.DEFAULT_GOAL := help
.PHONY: help install dev test lint typecheck check eval ml sample-data smoke docker clean

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'

$(BIN)/python:
	@$(PYTHON) -c 'import sys; sys.exit(sys.version_info < (3, 12))' || { \
	  echo "Нужен Python 3.12+ (сейчас: $$($(PYTHON) --version 2>&1)). brew install python@3.13 и make install PYTHON=python3.13, или make docker"; exit 1; }
	$(PYTHON) -m venv $(VENV)

install: $(BIN)/python ## create .venv and install runtime + ML + dev dependencies
	$(BIN)/python -m pip install --upgrade pip
	$(BIN)/python -m pip install -r requirements-dev.txt

dev: ## run the API with auto-reload on PORT (default 8000): / playground, /docs OpenAPI
	$(BIN)/python -m uvicorn app.main:app --reload --port $(PORT)

test: ## offline test suite (mock mode, no network)
	$(BIN)/python -m pytest

lint: ## ruff lint + format check
	$(BIN)/ruff check .
	$(BIN)/ruff format --check .

typecheck: ## mypy --strict
	$(BIN)/mypy

check: lint typecheck test ## everything CI should run

eval: ## evaluate TASK on DATASET, e.g. make eval ARGS="--limit 10 --no-cache"
	$(BIN)/python -m evals.run_eval --task $(TASK) --dataset $(DATASET) $(ARGS)

ml: ## tabular baseline, e.g. make ml CSV=data/case.csv TARGET=churned ARGS="--drop user_id"
	$(BIN)/python -m ml.baseline --csv $(CSV) --target $(TARGET) $(ARGS)

sample-data: ## regenerate the synthetic telemetry CSV
	$(BIN)/python -m ml.make_sample_telemetry --out $(CSV)

smoke: ## ONE real LLM call (needs ANTHROPIC_API_KEY or OPENAI_COMPAT_API_KEY in .env)
	$(BIN)/python -m scripts.smoke

docker: ## build and run the API in Docker on :8000
	docker compose up --build

clean: ## remove caches and generated reports (keeps example.md files)
	rm -rf .cache .pytest_cache .mypy_cache .ruff_cache
	find evals/reports ml/reports -type f ! -name example.md -delete
