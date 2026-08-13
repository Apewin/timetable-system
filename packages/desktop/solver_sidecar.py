"""Portable CP-SAT process used by the packaged Windows application.

The Node backend writes an OR-Tools CpModelProto and SatParameters as binary
protobuf files.  This process solves the model with the official Python
OR-Tools distribution and writes a CpSolverResponse protobuf back.  Keeping
the protocol protobuf-only means the scheduling model remains authored once
in JavaScript while Windows can use Google's supported native wheel.
"""

from pathlib import Path
import sys

from google.protobuf import text_format
from ortools.sat import cp_model_pb2, sat_parameters_pb2
from ortools.sat.python import cp_model


def solve(model_path: Path, parameters_path: Path, response_path: Path) -> None:
    model_proto = cp_model_pb2.CpModelProto()
    model_proto.ParseFromString(model_path.read_bytes())

    parameters = sat_parameters_pb2.SatParameters()
    parameters.ParseFromString(parameters_path.read_bytes())

    model = cp_model.CpModel()
    model.proto.parse_text_format(text_format.MessageToString(model_proto))
    solver = cp_model.CpSolver()
    solver.parameters.parse_text_format(text_format.MessageToString(parameters))
    solver.solve(model)
    response = cp_model_pb2.CpSolverResponse()
    text_format.Parse(str(solver.response_proto), response)
    response_path.write_bytes(response.SerializeToString())


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(
            "usage: timetable-solver MODEL_BIN PARAMETERS_BIN RESPONSE_BIN",
            file=sys.stderr,
        )
        return 2
    solve(*(Path(value) for value in argv[1:]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
