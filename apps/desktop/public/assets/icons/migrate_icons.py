#!/usr/bin/env python3
import os
import shutil
import re
import sys
from pathlib import Path
from collections import defaultdict

# 定义源目录和目标目录
SOURCE_DIR = '/Users/yoho/Downloads/material-design-icons-master/symbols/web'
TARGET_DIR = '/Users/yoho/Downloads/material-design-icons-master/out'

def should_process_folder(folder_name):
    """判断文件夹是否需要处理（从abc开始）"""
    return folder_name >= 'abc'

def extract_base_name(file_name):
    """从文件名提取基本名称和编号"""
    match = re.match(r'^(.+?)(?:_(\d+))?$', file_name)
    if match:
        base_name = match.group(1)
        number = int(match.group(2)) if match.group(2) else 0
        return base_name, number
    return file_name, 0

def main():
    # 确保目标目录存在
    os.makedirs(TARGET_DIR, exist_ok=True)
    
    # 用于存储每个基本图标名称的最新版本
    icon_versions = defaultdict(lambda: {'number': -1, 'folder': ''})
    
    print("开始扫描图标...")
    
    # 第一步：扫描目录，找出每个基本图标的最新版本
    for folder_name in sorted(os.listdir(SOURCE_DIR)):
        folder_path = os.path.join(SOURCE_DIR, folder_name)
        
        # 跳过非目录或abc之前的目录
        if not os.path.isdir(folder_path) or not should_process_folder(folder_name):
            continue
        
        # 提取文件夹基本名称和编号
        base_name, number = extract_base_name(folder_name)
        
        # 只保留编号最大的版本
        if number >= icon_versions[base_name]['number']:
            icon_versions[base_name] = {'number': number, 'folder': folder_name}
    
    print(f"找到 {len(icon_versions)} 个基本图标")
    
    # 第二步：复制和重命名选定的图标
    for base_name, info in icon_versions.items():
        source_folder = os.path.join(SOURCE_DIR, info['folder'], 'materialsymbolsrounded')
        
        if not os.path.exists(source_folder):
            print(f"警告: {source_folder} 不存在，跳过")
            continue
        
        # 处理普通版本
        normal_svg = f"{info['folder']}_24px.svg"
        normal_svg_path = os.path.join(source_folder, normal_svg)
        
        if os.path.exists(normal_svg_path):
            target_path = os.path.join(TARGET_DIR, f"{base_name}.svg")
            shutil.copy2(normal_svg_path, target_path)
            print(f"复制: {normal_svg_path} -> {target_path}")
        else:
            print(f"警告: {normal_svg_path} 不存在")
        
        # 处理填充版本
        fill_svg = f"{info['folder']}_fill1_24px.svg"
        fill_svg_path = os.path.join(source_folder, fill_svg)
        
        if os.path.exists(fill_svg_path):
            target_path = os.path.join(TARGET_DIR, f"{base_name}_fill.svg")
            shutil.copy2(fill_svg_path, target_path)
            print(f"复制: {fill_svg_path} -> {target_path}")
        else:
            print(f"警告: {fill_svg_path} 不存在")
    
    print("图标迁移完成！")

if __name__ == "__main__":
    main()
