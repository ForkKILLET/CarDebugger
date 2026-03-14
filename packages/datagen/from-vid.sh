#!/usr/bin/env bash

if [ -z "$VID" ]; then
  echo "missing \$VID"
  exit 1
fi
if [ -z "$START" ]; then
  echo "missing \$START"
  exit 1
fi
if [ -z "$END" ]; then
  echo "missing \$END"
  exit 1
fi
if [ -z "$SET" ]; then
  echo "missing \$SET"
  exit 1
fi
if [ -n "$NIX" ]; then
  NIX_POSTFIX="-nix"
fi

script_dir=$(dirname "$(realpath "$0")")
data_dir=${script_dir}/../../Test/Data

ffmpeg -i ${VID} -vf "mpdecimate" -vsync vfr -ss ${START} -to ${END} ${data_dir}/Images/${SET}_%d.png

count=$(ls ${data_dir}/Images/${SET}_*.png | wc -l)

./run${NIX_POSTFIX}.sh ../../Test/Data/Images/${SET}_{1..${count}}.png

