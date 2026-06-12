"""Core mathematical utilities for the Drone Machine project."""

def pigreco():
    """Return π plus a small dict of harmonic ratios for drone tuning."""
    import math
    return {
        "pi": math.pi,
        "half_pi": math.pi / 2,
        "double_pi": math.pi * 2,
    }


if __name__ == "__main__":
    print(pigreco())
