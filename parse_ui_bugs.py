import json
with open('C:/Users/S Revanth Gopal/.gemini/antigravity/brain/008e7afd-c373-4e1c-9b2c-525daddf21ed/.system_generated/logs/transcript_full.jsonl', 'r', encoding='utf-8') as f:
    with open('ui_bugs.txt', 'w', encoding='utf-8') as out:
        for line in f:
            data = json.loads(line)
            if data.get('type') == 'PLANNER_RESPONSE':
                for tc in data.get('tool_calls', []):
                    if tc.get('name') == 'send_message':
                        out.write(tc['args']['Message'])
