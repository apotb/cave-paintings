from actions import Action

class Attack(Action):
    name = 'Attack'
    damage = 0
    variance = 0.05
    type = ''
    verb = ''
    cooldown = 2.0
    weightMultiplier = 1
    usesMass = False

    def __init__(self, source):
        self.source = source

    def dps(self):
        damage = self.damage * self.source.hp()
        return damage / self.cooldown

    def weight(self):
        return self.dps() * self.weightMultiplier

class Punch(Attack):
    name = 'Punch'
    damage = 6
    type = 'blunt'
    verb = 'swung'

class Kick(Attack):
    name = 'Kick'
    damage = 4
    type = 'blunt'
    verb = 'kicked'

class Headbutt(Attack):
    name = 'Headbutt'
    damage = 3
    type = 'blunt'
    verb = 'bashed'
    weightMultiplier = 0.2

class Bite(Attack):
    name = 'Bite'
    damage = 4
    type = 'sharp'
    verb = 'sunk'
    weightMultiplier = 0.2

class Bodyslam(Attack):
    name = 'Bodyslam'
    damage = 8
    type = 'blunt'
    verb = 'slammed'
    usesMass = True