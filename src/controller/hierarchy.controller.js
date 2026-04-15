import prisma from "../prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// GET /api/users/hierarchy - Get organizational hierarchy (Super Admin → Admins → Team Members)
export const getTeamHierarchy = asyncHandler(async (req, res) => {
  try {
    console.log("Fetching organizational hierarchy...");

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true,
            department: true
          }
        },
        children: {
          include: {
            children: true
          }
        }
      },
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ]
    });

    console.log(`Found ${users.length} users for hierarchy`);

    // Find Super Admin (Company Boss)
    const superAdmin = users.find(user => user.role === 'SUPER_ADMIN');

    if (!superAdmin) {
      throw new ApiError(404, "Super Admin not found in the system");
    }

    // Find Admins (Team Leads)
    const admins = users.filter(user => user.role === 'ADMIN');

    // Find Team Members (Regular Users)
    const teamMembers = users.filter(user => user.role === 'USER');

    // CORRECTED: Build department-based hierarchy
    const hierarchy = {
      ...superAdmin,
      children: admins.map(admin => ({
        ...admin,
        // Only show team members from the SAME department under this admin
        children: teamMembers.filter(member =>
          member.department === admin.department &&
          member.parentId === admin.id
        )
      })).filter(admin => admin.children.length > 0) // Only show admins who have team members
    };

    // Calculate statistics
    const statistics = {
      totalUsers: users.length,
      superAdmins: 1, // Only one company boss
      teamLeads: admins.length,
      teamMembers: teamMembers.length,
      byDepartment: users.reduce((acc, user) => {
        const dept = user.department || 'Unassigned';
        acc[dept] = (acc[dept] || 0) + 1;
        return acc;
      }, {}),
      teamLeadStats: admins.map(admin => ({
        id: admin.id,
        name: admin.name,
        department: admin.department,
        teamSize: teamMembers.filter(member =>
          member.department === admin.department &&
          member.parentId === admin.id
        ).length
      }))
    };

    res.status(200).json(new ApiResponse(200, {
      hierarchy,
      flatView: {
        companyBoss: superAdmin,
        teamLeads: admins,
        teamMembers: teamMembers
      },
      statistics
    }, "Organizational hierarchy retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching hierarchy:', error);
    throw new ApiError(500, "Failed to retrieve organizational hierarchy");
  }
});

// GET /api/users/hierarchy/simple - Simple flat hierarchy for tables
export const getSimpleHierarchy = asyncHandler(async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true
          }
        }
      },
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ]
    });

    const formattedUsers = users.map(user => {
      let position = '';
      let reportsTo = '';

      if (user.role === 'SUPER_ADMIN') {
        position = 'Company Boss';
        reportsTo = 'None';
      } else if (user.role === 'ADMIN') {
        position = 'Team Lead';
        reportsTo = user.parent ? user.parent.name : 'Company Boss';
      } else {
        position = 'Team Member';
        reportsTo = user.parent ? user.parent.name : 'Unassigned';
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        department: user.department,
        position: position,
        reportsTo: reportsTo,
        isOnline: user.isOnline,
        status: user.status,
        phone: user.phone,
        lastSeen: user.lastSeen
      };
    });

    res.status(200).json(new ApiResponse(200, {
      users: formattedUsers,
      summary: {
        total: formattedUsers.length,
        companyBoss: formattedUsers.filter(u => u.role === 'SUPER_ADMIN').length,
        teamLeads: formattedUsers.filter(u => u.role === 'ADMIN').length,
        teamMembers: formattedUsers.filter(u => u.role === 'USER').length
      }
    }, "Simple hierarchy retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching simple hierarchy:', error);
    throw new ApiError(500, "Failed to retrieve simple hierarchy");
  }
});

// GET /api/users/hierarchy/team-leads - Get all team leads with their teams
export const getTeamLeadsWithTeams = asyncHandler(async (req, res) => {
  try {
    const teamLeads = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        isActive: true,
        deletedAt: null
      },
      include: {
        children: {
          where: {
            isActive: true,
            deletedAt: null
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            avatarUrl: true,
            role: true,
            department: true,
            isOnline: true,
            status: true
          },
          orderBy: { name: 'asc' }
        },
        _count: {
          select: {
            children: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const companyBoss = await prisma.user.findFirst({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true
      }
    });

    res.status(200).json(new ApiResponse(200, {
      companyBoss,
      teamLeads: teamLeads.map(lead => ({
        id: lead.id,
        name: lead.name,
        username: lead.username,
        email: lead.email,
        avatarUrl: lead.avatarUrl,
        department: lead.department,
        isOnline: lead.isOnline,
        status: lead.status,
        teamSize: lead._count.children,
        teamMembers: lead.children
      })),
      statistics: {
        totalTeamLeads: teamLeads.length,
        totalTeamMembers: teamLeads.reduce((sum, lead) => sum + lead._count.children, 0),
        teamsByDepartment: teamLeads.reduce((acc, lead) => {
          const dept = lead.department || 'Unassigned';
          acc[dept] = (acc[dept] || 0) + 1;
          return acc;
        }, {})
      }
    }, "Team leads with teams retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching team leads:', error);
    throw new ApiError(500, "Failed to retrieve team leads");
  }
});

// GET /api/users/hierarchy/unassigned - Get team members without team leads
export const getUnassignedTeamMembers = asyncHandler(async (req, res) => {
  try {
    const unassignedMembers = await prisma.user.findMany({
      where: {
        role: 'USER',
        parentId: null, // No team lead assigned
        isActive: true,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        department: true,
        isOnline: true,
        status: true,
        phone: true,
        lastSeen: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    res.status(200).json(new ApiResponse(200, {
      unassignedMembers,
      total: unassignedMembers.length,
      byDepartment: unassignedMembers.reduce((acc, member) => {
        const dept = member.department || 'Unassigned';
        acc[dept] = (acc[dept] || 0) + 1;
        return acc;
      }, {})
    }, "Unassigned team members retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching unassigned members:', error);
    throw new ApiError(500, "Failed to retrieve unassigned team members");
  }
});

// GET /api/users/departments - Get all departments with counts
export const getDepartments = asyncHandler(async (req, res) => {
  try {
    const departmentStats = await prisma.user.groupBy({
      by: ['department'],
      where: {
        isActive: true,
        deletedAt: null,
        department: { not: null, not: 'CLIENT' }
      },
      _count: {
        id: true
      }
    });

    const departmentsWithCounts = await Promise.all(
      departmentStats.map(async (dept) => {
        // Count team leads (ADMIN role)
        const teamLeadsCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: { in: ['ADMIN', 'SUPER_ADMIN'] },
            isActive: true
          }
        });

        // Count team members (USER role)  
        const teamMembersCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: 'USER',
            isActive: true
          }
        });

        // Count SUPER_ADMIN separately or exclude from lead/member counts
        const superAdminCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: 'SUPER_ADMIN',
            isActive: true
          }
        });

        return {
          name: dept.department,
          count: dept._count.id,
          teamLeads: teamLeadsCount,
          teamMembers: teamMembersCount,
          superAdmins: superAdminCount // Optional: track SUPER_ADMIN separately
        };
      })
    );

    res.status(200).json(new ApiResponse(200, {
      departments: departmentsWithCounts,
      totalDepartments: departmentsWithCounts.length
    }, "Departments retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching departments:', error);
    throw new ApiError(500, "Failed to retrieve departments");
  }
});

export const autoAssignTeams = asyncHandler(async (req, res) => {
  console.log("Auto-assigning team members by department...");

  // Get all unassigned team members
  const teamMembers = await prisma.user.findMany({
    where: {
      role: 'USER',
      parentId: null,
      isActive: true,
      department: { not: null } // Only assign those with departments
    }
  });

  // Get all admins (team leaders)
  const admins = await prisma.user.findMany({
    where: {
      role: 'ADMIN',
      isActive: true
    }
  });


  console.log(`Found ${teamMembers.length} unassigned team members and ${admins.length} admins`);

  let assignedCount = 0;
  const assignments = [];

  // Group team members by department
  const membersByDepartment = {};
  teamMembers.forEach(member => {
    if (!membersByDepartment[member.department]) {
      membersByDepartment[member.department] = [];
    }
    membersByDepartment[member.department].push(member);
  });

  // Assign each department's team members to their department admin
  for (const [department, members] of Object.entries(membersByDepartment)) {
    // Find admin in this department
    const departmentAdmin = admins.find(admin => admin.department === department);

    if (departmentAdmin && members.length > 0) {
      // Assign all department members to this admin
      for (const member of members) {
        await prisma.user.update({
          where: { id: member.id },
          data: { parentId: departmentAdmin.id }
        });
        assignments.push(`${member.name} → ${departmentAdmin.name} (${department})`);
        assignedCount++;
      }
      console.log(`Assigned ${members.length} ${department} members to ${departmentAdmin.name}`);
    } else {
      console.log(`No admin found for ${department} department - ${members.length} members unassigned`);
    }
  }

  res.json(new ApiResponse(200, {
    assigned: assignedCount,
    remaining: teamMembers.length - assignedCount,
    assignments: assignments,
    message: `Successfully assigned ${assignedCount} team members to their department admins`
  }, "Department-based team assignment completed"));
});

// NEW: Manual assignment of team member to admin
export const assignTeamMember = asyncHandler(async (req, res) => {
  const { teamMemberId, adminId } = req.body;

  const teamMember = await prisma.user.findUnique({
    where: { id: teamMemberId }
  });

  const admin = await prisma.user.findUnique({
    where: { id: adminId }
  });

  if (!teamMember || teamMember.role !== 'USER') {
    throw new ApiError(400, "Invalid team member");
  }

  if (!admin || admin.role !== 'ADMIN') {
    throw new ApiError(400, "Invalid admin/team leader");
  }

  const updatedMember = await prisma.user.update({
    where: { id: teamMemberId },
    data: { parentId: adminId }
  });

  res.json(new ApiResponse(200, updatedMember, "Team member assigned to admin successfully"));
});

// Add this to your hierarchyController.js
export const getDepartmentUsers = asyncHandler(async (req, res) => {
  try {
    const { departmentName } = req.params;

    // Handle case sensitivity for Manager department - SIMPLIFIED
    const departmentCondition = { department: departmentName };

    const users = await prisma.user.findMany({
      where: {
        ...departmentCondition,
        isActive: true,
        deletedAt: null
      },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        isOnline: true,
        status: true,
        department: true,
        parentId: true,
        avatarUrl: true,
        designation: true // ADD this to include designation
      },
      orderBy: [
        { role: 'desc' }, // Admins first
        { name: 'asc' }
      ]
    });

    console.log(`📊 Found ${users.length} users in department: ${departmentName}`);
    console.log('👥 Users:', users.map(u => ({ name: u.name, department: u.department, role: u.role, designation: u.designation })));

    res.status(200).json(new ApiResponse(200, { users }, "Department users retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching department users:', error);
    throw new ApiError(500, "Failed to retrieve department users");
  }
});

// NEW: Get designations for a specific department// NEW: Get designations for a specific department
export const getDesignationsByDepartment = asyncHandler(async (req, res) => {
  try {
    const { departmentName } = req.params;

    console.log(`Fetching designations for department: ${departmentName}`);

    const users = await prisma.user.findMany({
      where: {
        department: departmentName,
        isActive: true,
        deletedAt: null,
        designation: { not: null } // ONLY users with designations
      },
      select: {
        id: true,
        name: true,
        role: true,
        designation: true,
        isOnline: true,
        status: true,
        avatarUrl: true,
        email: true
      }
    });

    if (users.length === 0) {
      throw new ApiError(404, `No users found in department: ${departmentName}`);
    }

    // Group users by designation
    const designationMap = {};

    users.forEach(user => {
      const designation = user.designation; // No need for Unassigned check

      if (!designationMap[designation]) {
        designationMap[designation] = {
          name: designation,
          leads: [],
          members: [],
          totalMembers: 0
        };
      }

      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        designationMap[designation].leads.push({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isOnline: user.isOnline,
          status: user.status,
          avatarUrl: user.avatarUrl
        });
      } else if (user.role === 'USER') {
        designationMap[designation].members.push({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isOnline: user.isOnline,
          status: user.status,
          avatarUrl: user.avatarUrl
        });
      }

      designationMap[designation].totalMembers++;
    });

    const designations = Object.values(designationMap).map(designation => ({
      ...designation,
      leadsCount: designation.leads.length,
      membersCount: designation.members.length
    }));

    console.log(`Found ${designations.length} designations in ${departmentName}`);

    res.status(200).json(new ApiResponse(200, {
      department: departmentName,
      designations,
      statistics: {
        totalDesignations: designations.length,
        totalUsers: users.length,
        totalLeads: designations.reduce((sum, designation) => sum + designation.leadsCount, 0),
        totalMembers: designations.reduce((sum, designation) => sum + designation.membersCount, 0)
      }
    }, "Designations retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching designations:', error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to retrieve designations");
  }
});

// NEW: Get users for a specific designation
export const getUsersByDesignation = asyncHandler(async (req, res) => {
  try {
    const { designationName } = req.params;

    console.log(`Fetching users for designation: ${designationName}`);

    const users = await prisma.user.findMany({
      where: {
        designation: designationName,
        isActive: true,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isOnline: true,
        status: true,
        avatarUrl: true,
        phone: true,
        lastSeen: true,
        createdAt: true,
        department: true
      },
      orderBy: [
        { role: 'desc' }, // Admins first
        { name: 'asc' }
      ]
    });

    if (users.length === 0) {
      throw new ApiError(404, `No users found in designation: ${designationName}`);
    }

    // Separate leads and members
    const leads = users.filter(user => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN');
    const members = users.filter(user => user.role === 'USER');

    console.log(`Found ${users.length} users in ${designationName} (${leads.length} leads, ${members.length} members)`);

    res.status(200).json(new ApiResponse(200, {
      designation: designationName,
      users: {
        leads,
        members
      },
      statistics: {
        totalUsers: users.length,
        leadsCount: leads.length,
        membersCount: members.length,
        onlineUsers: users.filter(user => user.isOnline).length
      }
    }, "Designation users retrieved successfully"));

  } catch (error) {
    console.error('💥 Error fetching designation users:', error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to retrieve designation users");
  }
});