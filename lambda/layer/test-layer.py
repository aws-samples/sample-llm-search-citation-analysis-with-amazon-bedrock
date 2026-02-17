#!/usr/bin/env python3
"""
Test script to verify Lambda Layer structure and imports.
Run this after building the layer to ensure everything is packaged correctly.
"""

import sys
import os
from pathlib import Path

def test_layer_structure():
    """Test that the layer has the correct directory structure."""
    print("Testing Lambda Layer structure...")
    
    layer_dir = Path("python")
    
    # Check main directory exists
    if not layer_dir.exists():
        print("❌ ERROR: python/ directory not found. Run build-layer.sh first.")
        return False
    
    print("✅ python/ directory exists")
    
    # Check shared directory exists
    shared_dir = layer_dir / "shared"
    if not shared_dir.exists():
        print("❌ ERROR: python/shared/ directory not found")
        return False
    
    print("✅ python/shared/ directory exists")
    
    # Check required files
    required_files = [
        "shared/__init__.py",
        "shared/config.py",
        "shared/utils.py",
        "shared/browser_tools.py"
    ]
    
    for file_path in required_files:
        full_path = layer_dir / file_path
        if not full_path.exists():
            print(f"❌ ERROR: {file_path} not found")
            return False
        print(f"✅ {file_path} exists")
    
    return True


def test_imports():
    """Test that modules can be imported."""
    print("\nTesting imports...")
    
    # Add layer to Python path
    layer_dir = Path("python").absolute()
    sys.path.insert(0, str(layer_dir))
    
    try:
        # Test config import
        from shared.config import LambdaConfig
        print("✅ Successfully imported LambdaConfig")
        
        # Test creating config instance
        config = LambdaConfig()
        print(f"✅ Created LambdaConfig instance (region: {config.region})")
        
        # Test utils import
        from shared.utils import normalize_url, get_timestamp, truncate_text
        print("✅ Successfully imported utility functions")
        
        # Test utility functions
        test_url = "https://example.com/page?utm_source=test&fbclid=123"
        normalized = normalize_url(test_url)
        print(f"✅ URL normalization works: {normalized}")
        
        timestamp = get_timestamp()
        print(f"✅ Timestamp generation works: {timestamp}")
        
        truncated = truncate_text("x" * 100, max_length=50)
        print(f"✅ Text truncation works: {len(truncated)} chars")
        
        # Test browser_tools import
        from shared.browser_tools import SimpleBrowserTools
        print("✅ Successfully imported SimpleBrowserTools")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Error testing imports: {e}")
        return False


def test_dependencies():
    """Test that required dependencies are installed."""
    print("\nTesting dependencies...")
    
    layer_dir = Path("python").absolute()
    sys.path.insert(0, str(layer_dir))
    
    dependencies = [
        ("boto3", "AWS SDK"),
        ("playwright", "Browser automation"),
        ("requests", "HTTP library"),
    ]
    
    all_ok = True
    for module_name, description in dependencies:
        try:
            __import__(module_name)
            print(f"✅ {description} ({module_name}) is installed")
        except ImportError:
            print(f"❌ {description} ({module_name}) is NOT installed")
            all_ok = False
    
    return all_ok


def main():
    """Run all tests."""
    print("=" * 60)
    print("Lambda Layer Test Suite")
    print("=" * 60)
    
    # Test structure
    structure_ok = test_layer_structure()
    
    if not structure_ok:
        print("\n❌ Layer structure test FAILED")
        print("Run ./build-layer.sh to build the layer first")
        sys.exit(1)
    
    # Test imports
    imports_ok = test_imports()
    
    # Test dependencies
    deps_ok = test_dependencies()
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Structure: {'✅ PASS' if structure_ok else '❌ FAIL'}")
    print(f"Imports:   {'✅ PASS' if imports_ok else '❌ FAIL'}")
    print(f"Dependencies: {'✅ PASS' if deps_ok else '❌ FAIL'}")
    
    if structure_ok and imports_ok and deps_ok:
        print("\n🎉 All tests passed! Layer is ready for deployment.")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Please fix the issues above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
