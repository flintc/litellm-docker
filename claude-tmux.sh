#!/bin/bash
# Script to run claude in a tmux session and send "testing" command

SESSION_NAME="claude-session"

# Kill existing session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create new tmux session in detached mode
tmux new-session -d -s "$SESSION_NAME"

# Run claude command in the session
tmux send-keys -t "$SESSION_NAME" "claude" Enter

# Wait a moment for claude to start
sleep 2

# Send "testing" and enter
tmux send-keys -t "$SESSION_NAME" "testing" Enter

echo "$(date): Started claude in tmux session '$SESSION_NAME' and sent 'testing'" >> /var/log/claude-tmux.log
