import xml.etree.ElementTree as ET
import sys

tree = ET.parse(sys.argv[1])
root = tree.getroot()

for node in root.iter('node'):
    text = node.attrib.get('text', '').strip()
    desc = node.attrib.get('content-desc', '').strip()
    bounds = node.attrib.get('bounds', '')
    if text:
        print(f"TEXT: '{text}' at {bounds}")
    elif desc:
        print(f"DESC: '{desc}' at {bounds}")
