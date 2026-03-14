#!/usr/bin/env bash

nix-shell --run "node --no-warnings --loader ts-node/esm index.ts $*"
