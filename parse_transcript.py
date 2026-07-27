import json
with open('C:/Users/S Revanth Gopal/.gemini/antigravity/brain/84d5b1e9-93b2-4b2b-9b9c-afa17653b291/.system_generated/logs/transcript_full.jsonl', 'r', encoding='utf-8') as f:
    with open('nav_bugs.txt', 'w', encoding='utf-8') as out:
        for line in f:
            data = json.loads(line)
            if data.get('type') == 'PLANNER_RESPONSE':
                for tc in data.get('tool_calls', []):
                    if tc.get('name') == 'send_message':
                        out.write(tc['args']['Message'])
