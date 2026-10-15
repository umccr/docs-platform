class DocsError(Exception):
    """A problem the author has to fix. The CLI prints it without a traceback."""

    def __init__(self, message: str, problems: list[str] | None = None) -> None:
        super().__init__(message)
        self.problems = problems or []

    def __str__(self) -> str:
        if not self.problems:
            return super().__str__()
        listed = "\n".join(f"  - {problem}" for problem in self.problems)
        return f"{super().__str__()}\n{listed}"
