import os

# Define the root directories you want to scan
project_root = 'd:/GenGal'
output_file = 'd:/GenGal/all_code_export.md'

# Directories to ignore
ignore_dirs = {
    'node_modules', '.git', '.expo', 'dist', 'android', 'ios', 
    'venv', '__pycache__', '.idea', '.cursor', 'temp_media'
}

# File extensions to include
include_exts = {'.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.css'}

# Files to ignore (e.g. package-lock.json)
ignore_files = {'package-lock.json'}

with open(output_file, 'w', encoding='utf-8') as out:
    for root, dirs, files in os.walk(project_root):
        # Modify dirs in-place to skip ignored directories
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        
        for file in files:
            if file in ignore_files:
                continue
            
            ext = os.path.splitext(file)[1].lower()
            if ext in include_exts:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_root)
                
                out.write(f"\n\n# {rel_path}\n")
                out.write(f"```{ext[1:]}\n")
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        out.write(f.read())
                except Exception as e:
                    out.write(f"// Error reading file: {e}\n")
                out.write("\n```\n")

print(f"Code successfully exported to {output_file}")
