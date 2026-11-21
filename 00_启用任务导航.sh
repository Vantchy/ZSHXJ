#!/bin/sh
cd "$(dirname "$0")" || exit 1
python3 tools/activate_quest_navigation.py --apply
