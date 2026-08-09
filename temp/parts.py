import random
from actions import *
from attacks import *

class Part:
    name = 'Part'
    mhp = 10
    coverage = 0.00
    internal = False
    actions = []
    attacks = []
    singleLimbs = []
    pairLimbs = []

    def __init__(self, name=None, side=''):
        if name != None:
            self.name = name
        self.side = side
        self.dead = False
        self.attacks = [attack(self) for attack in self.attacks]
        self.injuries = []
        self.limbs = {}
        self.initLimbs()

    def initLimbs(self):
        for limb in self.singleLimbs:
            limb = limb(self.side + limb.name, self.side)
            self.limbs[limb.name] = limb
        for limb in self.pairLimbs:
            limb1 = limb('Left ' + limb.name, 'Left ')
            limb2 = limb('Right ' + limb.name, 'Right ')
            self.limbs[limb1.name] = limb1
            self.limbs[limb2.name] = limb2

    def refresh(self):
        if self.hp() == 0:
            self.destroy()

    def rollLimb(self, internal=False):
        coverages = {}
        for limb in self.limbs:
            if self.limbs[limb].internal == internal:
                coverages[limb] = self.limbs[limb].coverage
        rnd = random.random()
        for part in coverages:
            rnd -= coverages[part]
            if rnd < 0:
                limb = self.limbs[part]
                if limb.internal and len(limb.limbs) == 0:
                    return limb
                else:
                    return limb.rollLimb()
        if not internal:
            return self.rollLimb(True)
        else:
            return self

    def injure(self, injury):
        self.injuries.append(injury)
        self.refresh()

    def fullHeal(self):
        self.injuries = []

    def destroy(self):
        self.dead = True
        self.injuries = []
        self.limbs = {}

    def isDead(self):
        return self.dead

    def hp(self):
        damage = sum([injury.severity for injury in self.injuries])
        return max(self.mhp - damage, 0)

    def efficiency(self):
        return self.hp() / self.mhp if not self.dead else 0

# Human

class Brain(Part):
    name = 'Brain'
    mhp = 10
    coverage = 0.80
    internal = True

class Skull(Part):
    name = 'Skull'
    mhp = 25
    coverage = 0.18
    internal = True
    singleLimbs = [Brain]

class Eye(Part):
    name = 'Eye'
    mhp = 10
    coverage = 0.07

class Ear(Part):
    name = 'Ear'
    mhp = 12
    coverage = 0.07

class Nose(Part):
    name = 'Nose'
    mhp = 10
    coverage = 0.10

class Tongue(Part):
    name = 'Tongue'
    mhp = 10
    coverage = 0.001
    internal = True

class Jaw(Part):
    name = 'Jaw'
    mhp = 20
    coverage = 0.15
    attacks = [Bite]
    singleLimbs = [Tongue]

class Head(Part):
    name = 'Head'
    mhp = 25
    coverage = 0.80
    attacks = [Headbutt]
    singleLimbs = [Skull, Nose, Jaw]
    pairLimbs = [Eye, Ear]

class Neck(Part):
    name = 'Neck'
    mhp = 25
    coverage = 0.075
    singleLimbs = [Head]

class Waist(Part):
    name = 'Waist'
    mhp = 10

class Spine(Part):
    name = 'Spine'
    mhp = 25
    coverage = 0.025
    internal = True

class Ribcage(Part):
    name = 'Ribcage'
    mhp = 30
    coverage = 0.036
    internal = True

class Sternum(Part):
    name = 'Sternum'
    mhp = 20
    coverage = 0.015
    internal = True

class Heart(Part):
    name = 'Heart'
    mhp = 15
    coverage = 0.02
    internal = True

class Lung(Part):
    name = 'Lung'
    mhp = 15
    coverage = 0.025
    internal = True

class Stomach(Part):
    name = 'Stomach'
    mhp = 20
    coverage = 0.025
    internal = True

class Liver(Part):
    name = 'Liver'
    mhp = 20
    coverage = 0.025
    internal = True

class Kidney(Part):
    name = 'Kidney'
    mhp = 15
    coverage = 0.017
    internal = True

class Humerus(Part):
    name = 'Humerus'
    mhp = 25
    coverage = 0.10
    internal = True

class Radius(Part):
    name = 'Radius'
    mhp = 20
    coverage = 0.10
    internal = True

class Thumb(Part):
    name = 'Thumb'
    mhp = 8
    coverage = 0.08

class IndexFinger(Part):
    name = 'Index Finger'
    mhp = 8
    coverage = 0.07

class MiddleFinger(Part):
    name = 'Middle Finger'
    mhp = 8
    coverage = 0.08

class RingFinger(Part):
    name = 'Ring Finger'
    mhp = 8
    coverage = 0.07

class PinkyFinger(Part):
    name = 'Pinky Finger'
    mhp = 8
    coverage = 0.06

class Hand(Part):
    name = 'Hand'
    mhp = 20
    coverage = 0.14
    attacks = [Punch]
    singleLimbs = [Thumb, IndexFinger, MiddleFinger, RingFinger, PinkyFinger]

class Arm(Part):
    name = 'Arm'
    mhp = 30
    coverage = 0.77
    singleLimbs = [Humerus, Radius, Hand]

class Clavicle(Part):
    name = 'Clavicle'
    mhp = 25
    coverage = 0.09
    internal = True

class Shoulder(Part):
    name = 'Shoulder'
    mhp = 30
    coverage = 0.12
    singleLimbs = [Arm, Clavicle]

class Pelvis(Part):
    name = 'Pelvis'
    mhp = 25
    coverage = 0.025
    internal = True

class Femur(Part):
    name = 'Femur'
    mhp = 25
    coverage = 0.10
    internal = True

class Tibia(Part):
    name = 'Tibia'
    mhp = 25
    coverage = 0.10
    internal = True

class BigToe(Part):
    name = 'Big Toe'
    mhp = 8
    coverage = 0.09

class SecondToe(Part):
    name = 'Second Toe'
    mhp = 8
    coverage = 0.09

class MiddleToe(Part):
    name = 'Middle Toe'
    mhp = 8
    coverage = 0.08

class FourthToe(Part):
    name = 'Fourth Toe'
    mhp = 8
    coverage = 0.07

class LittleToe(Part):
    name = 'Little Toe'
    mhp = 8
    coverage = 0.06

class Foot(Part):
    name = 'Foot'
    mhp = 25
    coverage = 0.10
    attacks = [Kick]
    singleLimbs = [BigToe, SecondToe, MiddleToe, FourthToe, LittleToe]

class Leg(Part):
    name = 'Leg'
    mhp = 30
    coverage = 0.14
    actions = [Walk]
    singleLimbs = [Femur, Tibia, Foot]

class Torso(Part):
    name = 'Torso'
    mhp = 40
    coverage = 1.00
    singleLimbs = [Neck, Waist, Spine, Ribcage, Sternum, Heart, Stomach, Liver, Pelvis]
    pairLimbs = [Lung, Kidney, Shoulder, Leg]