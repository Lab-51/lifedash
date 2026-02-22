import os
import re
import glob

def clean_focus_rings(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Replace specific bugged focus rings with a standard slim version
    # Remove things like:
    # focus:ring-2
    # focus:ring-primary-500/50, focus:ring-primary-500/20, focus:ring-primary-500, etc.
    # dark:focus:ring-primary-500/40
    # focus:ring-emerald-500/20
    # outline-none (sometimes used instead of focus:outline-none) -> wait, outline-none is fine broadly, focus:outline-none is what we want.
    
    # Let's target the exact string fragments we want to remove
    fragments_to_remove = [
        r'focus:ring-2\s*',
        r'focus:ring-primary-500/[0-9]+\s*',
        r'focus:ring-primary-500\s*',
        r'dark:focus:ring-primary-500/[0-9]+\s*',
        r'focus:ring-emerald-500/[0-9]+\s*',
        r'focus:ring-1\s*',
        r'focus:ring-offset-2\s*',
        r'focus:ring-offset-surface-900\s*',
        r'dark:focus:ring-offset-surface-900\s*',
        r'focus:ring-emerald-400\s*'
    ]

    for frag in fragments_to_remove:
        content = re.sub(frag, '', content)
    
    # After removing rings, make sure inputs have focus:border-primary-500 and focus:outline-none
    # If it had focus:border-emerald-500 it might be left alone, which is fine, but let's check
    
    # Actually, replacing using regex might leave double spaces
    content = re.sub(r'\s{2,}', ' ', content)
    
    # We want to ensure inputs have focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500
    # But wait, we just wanted to thin it. If we removed the ring completely, then only focus:border-primary-500 remains.
    # A 1px border might be too thin (hard to see), so maybe focus:ring-1 focus:ring-primary-500 is the perfect "thin" look.
    
    # Let's revert the approach. Let's just blindly replace `focus:ring-2 focus:ring-primary-500/50` etc with `focus:ring-1 focus:ring-primary-500/50`.
    
    pass

def simpler_patch(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    
    # Convert ring-2 to ring-1
    content = content.replace('focus:ring-2', 'focus:ring-1')
    
    # Remove the opacity modifiers from the rings so it's a solid, crisp 1px line instead of a blurry messy aura
    # e.g. focus:ring-primary-500/50 -> focus:ring-primary-500
    content = re.sub(r'(focus:ring-[a-z]+-[0-9]+)/[0-9]+', r'\1', content)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

if __name__ == "__main__":
    search_path = "src/renderer/components/**/*.tsx"
    for filepath in glob.glob(search_path, recursive=True):
        simpler_patch(filepath)

