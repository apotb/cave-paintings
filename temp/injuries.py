class Injury:
    name = 'Injury'

    def __init__(self, severity, sourcePawn, sourcePart):
        self.severity = severity
        self.sourcePawn = sourcePawn
        self.sourcePart = sourcePart

class Cut(Injury):
    name = 'Cut'

class Bruise(Injury):
    name = 'Bruise'