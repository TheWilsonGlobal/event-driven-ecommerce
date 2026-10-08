.PHONY: help dev build test lint format docker-up docker-up-services docker-down docker-down-services

help:
	@echo "Event-Driven E-Commerce platform commands:"
	@echo "  make dev                 - Start all services locally (pnpm run dev)"
	@echo "  make build               - Build all packages"
	@echo "  make test                - Run unit and integration tests"
	@echo "  make docker-up           - Start application services (or full stack with Hub infra)"
	@echo "  make docker-up-services  - Start application services only (using external Hub infra)"
	@echo "  make docker-down         - Tear down application containers"
	@echo "  make docker-down-services- Tear down application containers"

dev:
	pnpm run dev

build:
	pnpm run build

test:
	pnpm run test

lint:
	pnpm run lint

format:
	pnpm run format

docker-up:
	docker compose up -d

docker-up-services:
	docker compose up -d

docker-down:
	docker compose down

docker-down-services:
	docker compose down

ci-lint:
	pnpm run lint
	pnpm run format:check

ci-test:
	pnpm run db:generate
	pnpm -r run test

ci-build:
	pnpm -r run build

docker-build-all:
	docker compose build
