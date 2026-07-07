from core.loader import load_codebase

repo_path = "data/repo"  # put your repo here

docs = load_codebase(repo_path)

print(f"Loaded {len(docs)} files")

# Print first file preview
if docs:
    print(docs[0]["source"])
    print(docs[0]["content"][:300])
    