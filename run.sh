#!/bin/bash
spin build && spin deploy

response=$(curl -d '{"context":"You are a bot that must try to find a famous person by asking questions to the user.", "prompt":"Hi I am Seb , you can ask me the first question to guess who I have in mind"}' https://localhost:3000/)

# Extract the 'id' using jq and assign it to a variable
id=$(echo "$response" | jq -r '.id')

echo $response
curl -d '{"id":"'"$id"'", "prompt":"no"}' https://localhost:3000
