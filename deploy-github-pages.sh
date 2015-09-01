#!/bin/bash
set -x
set -e

# if [ "$TRAVIS_PULL_REQUEST" != "false" -o "$TRAVIS_BRANCH" != "master" ]; then
#     exit 0;
# fi
env

git config user.name "Travis CI"
git config user.email "bernhard.urban@xamarin.com"

git add -f front-end/build
git commit -am "Deploy to GitHub Pages"

echo git push --force "https://${GH_TOKEN}@${GH_REF}" master:gh-pages
