from setuptools import setup, find_packages

setup(
    name="globalvision-replace",
    version="0.1.0",
    description="Internal artwork inspection tool - Text Inspection module",
    packages=find_packages(),
    install_requires=[
        "pymupdf",
        "pandas",
        "numpy",
        "scipy",
        "azure-cosmos",
        "azure-storage-blob",
        "azure-identity",
        "python-docx",
        "fonttools",
        "zxing-cpp",
    ],
)
