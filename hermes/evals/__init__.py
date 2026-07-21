"""Planner evals: does the real planner obey its own rules?

Deliberately outside `testpaths`, so `pytest` never collects it. An eval calls a
live model — it costs quota, needs credentials, and its result is a measurement
rather than a verdict. Wiring that into the test suite would either make the
suite flaky or, worse, train everyone to ignore a red suite.

Run it by hand:  python -m hermes.evals
"""
