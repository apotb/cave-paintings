import random
from parts import *
from injuries import *
from name import Name

class Pawn:
    species = 'Pawn'
    core = Part
    mass = 1

    def __init__(self, name='Pawn', age=0, gender='N'):
        self.gender = self.genderer(gender)
        self.name = self.namer(name)
        self.age = age
        self.core = self.core()

    def namer(self, name):
        if name == 'Pawn':
            name = self.species
        return Name(self, {'name': name}).name

    def displayName(self):
        return self.name.upper()

    def genderer(self, gender):
        return gender

    def pronoun(self):
        match self.gender:
            case 'M':
                return ['he', 'him', 'his']
            case 'F':
                return ['she', 'her', 'her']
            case 'NB':
                return ['they', 'them', 'their']
            case 'N' | _:
                return ['it', 'it', 'its']

    def bio(self):
        print()
        print(f"☺ {self.name}'S BIO")
        print(f" Age: {self.age}")
        print(f" Gender: {self.gender}")

    # Health

    def health(self):
        print()
        print(f"♥ {self.name}'S HEALTH")
        print(f" Conciousness: {self.conciousness() * 100:.0f}%")
        print(f" Moving: {self.moving() * 100:.0f}%")
        print(f" Manipulation: {self.manipulation() * 100:.0f}%")
        print(f" Sight: {self.sight() * 100:.0f}%")
        print(f" Hearing: {self.hearing() * 100:.0f}%")
        print(f" Speaking: {self.speaking() * 100:.0f}%")
        print(f" Eating: {self.eating() * 100:.0f}%")
        print(f" Breathing: {self.breathing() * 100:.0f}%")
        print(f" Blood Filtration: {self.bloodFiltration() * 100:.0f}%")
        print(f" Blood Pumping: {self.bloodPumping() * 100:.0f}%")
        print(f" Metabolism: {self.metabolism() * 100:.0f}%")
        print(f"\n⍨ INJURIES")
        injured = False
        for part in self.parts():
            part = self.part(part)
            if len(part.injuries) > 0:
                injured = True
                print(f" {part.name}: {part.hp():.1f} / {part.mhp} - {part.efficiency() * 100:.0f}% Efficiency")
                for i in part.injuries:
                    print(f"  {i.severity:.1f} - {i.name} from {i.sourcePawn.name}'s {i.sourcePart.name}")
            elif part.isDead():
                    print(f" {part.name}: Destroyed - {part.efficiency() * 100:.0f}% Efficiency")
        if not injured:
            print(f" None")

    def parts(self):
        limbs = [{self.core.name: self.core}]
        i = 0
        while len(limbs[i]) > 0:
            limbs.append({})
            for part in limbs[i]:
                limbs[i + 1].update(limbs[i][part].limbs)
            i += 1
        parts = {}
        for group in limbs:
            parts.update(group)
        return parts

    def part(self, name):
        return self.parts()[name]

    def refreshParts(self):
        for part in self.parts():
            self.part(part).refresh()

    def injure(self, part, injury):
        part.injure(injury)

    def fullHeal(self):
        for part in self.parts.values():
            part.fullHeal()

    def rollLimb(self):
        return self.core.rollLimb()

    # Stats

    def conciousness(self):
        return 1.0

    def moving(self):
        return 1.0

    def manipulation(self):
        return 1.0

    def sight(self):
        return 1.0

    def hearing(self):
        return 1.0

    def speaking(self):
        return 1.0

    def eating(self):
        return 1.0

    def breathing(self):
        return 1.0

    def bloodFiltration(self):
        return 1.0

    def bloodPumping(self):
        return 1.0

    def metabolism(self):
        return 1.0

    # Attacks

    def attacksRaw(self):
        return self.getAttacksFromParts() + self.getAttacksFromEquipment()

    def getAttacksFromParts(self):
        attacks = []
        for part in self.parts():
            attacks.extend(self.part(part).attacks)
        return attacks

    def getAttacksFromEquipment(self):
        attacks = []
        return attacks

    def attacks(self):
        attacks = self.attacksRaw()
        if len(attacks) == 0:
            attacks = [Punch(Part())] # Temporary fix for no attacks bug
        bound = max([attack.weight() for attack in attacks])
        return {
            'Best': [a for a in attacks if a.weight() >= 0.9 * bound],
            'Mid': [a for a in attacks if a.weight() >= 0.25 * bound and a.weight() < 0.9 * bound],
            'Worst': [a for a in attacks if a.weight() < 0.25 * bound]
        }

    def attack(self, target):
        if random.random() >= 0.25 or len(self.attacks()['Mid']) == 0:
            category = 'Best'
        else:
            category = 'Mid'
        attack = random.choice(self.attacks()[category])

        subject = self
        verb = attack.verb
        pronoun = self.pronoun()[2]
        sourcePart = attack.source
        victim = target.name
        victimPart = target.rollLimb()

        # Damage formula
        damage = attack.damage
        if attack.usesMass:
            damage *= self.mass
        damage *= random.randint(int(100 * (1 - attack.variance)), int(100 * (1 + attack.variance))) / 100
        damage = round(damage, 1)

        if attack.type == 'sharp':
            injury = Cut
        elif attack.type == 'blunt':
            injury = Bruise
        else:
            injury = Injury

        target.injure(victimPart, injury(damage, subject, sourcePart))
        print(f"{subject.name} {verb} {pronoun} {sourcePart.name} into {victim}'s {victimPart.name} for {damage} damage")
        victimPart.refresh()
        if victimPart.isDead():
            print(f"{victim}'s {victimPart.name} was destroyed!")

class Human(Pawn):
    species = 'Human'
    core = Torso
    mass = 1

    def namer(self, name):
        if name == 'Pawn':
            name = {}
        return Name(self, name)

    def genderer(self, gender):
        return random.choice(['M', 'F']) if gender == 'N' else gender

    def speaking(self):
        return (1.0 *
                self.conciousness() *
                self.part('Jaw').efficiency() *
                self.part('Tongue').efficiency()
        )
